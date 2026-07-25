package predictor

import (
	"fmt"
	"math"
	"sort"
	"time"

	"netlapse/internal/storage"
)

// Point is one projected network condition at a future time horizon.
type Point struct {
	HoursAhead        int     `json:"hours_ahead"`
	PredictedLatencyMs float64 `json:"predicted_latency_ms"`
	// IntervalMs is the ± half-width of a rough 95% prediction interval. A bare
	// number invites false precision; "820 ms ± 60" and "820 ms ± 900" are very
	// different claims and the reader deserves to see which one this is.
	IntervalMs float64 `json:"interval_ms"`
}

// Forecast is an explainable projection derived from recent TCP latency samples.
type Forecast struct {
	Domain              string    `json:"domain"`
	GeneratedAt          time.Time `json:"generated_at"`
	SampleCount          int       `json:"sample_count"`
	RecentSuccessRate    float64   `json:"recent_success_rate"`
	BaselineLatencyMs    float64   `json:"baseline_latency_ms"`
	TrendMsPerHour       float64   `json:"trend_ms_per_hour"`
	Confidence           string    `json:"confidence"`
	ConfidenceReason     string    `json:"confidence_reason"`
	Points               []Point   `json:"points"`
	// ObservedMinMs/ObservedMaxMs bound what actually happened in the window.
	// A projection outside this range is extrapolation, and the UI says so.
	ObservedMinMs float64 `json:"observed_min_ms"`
	ObservedMaxMs float64 `json:"observed_max_ms"`
	// MedianLatencyMs is the honest "what to expect" number when the trend is
	// weak: robust to the outliers that drag a least-squares line around.
	MedianLatencyMs float64 `json:"median_latency_ms"`
	// RSquared is the share of variance the trend explains, 0..1. Near zero
	// means the slope is fitting noise and the projection is not meaningful.
	RSquared float64 `json:"r_squared"`
	// TrendMeaningful is false when the data does not support projecting the
	// trend forward at all. The UI leads with the median instead.
	TrendMeaningful bool `json:"trend_meaningful"`
}

// Build learns a least-squares latency trend from the last 24 hours of samples.
func Build(store *storage.Storage, domain string, domainID int64) (Forecast, error) {
	now := time.Now().UTC()
	forecast := Forecast{Domain: domain, GeneratedAt: now, Points: make([]Point, 0)}
	samples, err := store.ListLatencySamples(domainID, now.Add(-24*time.Hour))
	if err != nil {
		return forecast, fmt.Errorf("load latency history: %w", err)
	}

	successes := 0
	for _, sample := range samples {
		if sample.Success {
			successes++
		}
	}
	forecast.SampleCount = len(samples)
	if len(samples) > 0 {
		forecast.RecentSuccessRate = float64(successes) / float64(len(samples))
	}
	if successes == 0 {
		forecast.Confidence = "insufficient"
		forecast.ConfidenceReason = "No successful latency samples are available in the last 24 hours."
		return forecast, nil
	}

	xValues := make([]float64, 0, successes)
	yValues := make([]float64, 0, successes)
	for _, sample := range samples {
		if !sample.Success {
			continue
		}
		xValues = append(xValues, sample.CapturedAt.Sub(now).Hours())
		yValues = append(yValues, sample.LatencyMs)
	}
	intercept, slope := fitLine(xValues, yValues)
	forecast.BaselineLatencyMs = math.Max(0, intercept)
	forecast.TrendMsPerHour = slope

	forecast.ObservedMinMs, forecast.ObservedMaxMs = minMax(yValues)
	forecast.MedianLatencyMs = median(yValues)
	residual := residualStdDev(xValues, yValues, intercept, slope)
	forecast.RSquared = rSquared(xValues, yValues, intercept, slope)

	// Only project the trend when it explains a real share of the variation and
	// rests on enough samples. Otherwise the slope is chasing noise: a +300 ms/h
	// line fitted to jittery samples produced a straight-faced "7744 ms in 24h"
	// for google.com, which is worse than declining to answer.
	forecast.TrendMeaningful = forecast.RSquared >= 0.3 && len(yValues) >= 10

	for _, hours := range []int{1, 6, 24} {
		predicted := median(yValues)
		if forecast.TrendMeaningful {
			predicted = intercept + slope*float64(hours)
		}
		// Clamp to plausible territory. Latency can't go negative, and a linear
		// fit has no business claiming an order-of-magnitude change it never
		// observed, so cap projections at twice the observed maximum.
		predicted = math.Max(0, math.Min(predicted, forecast.ObservedMaxMs*2))
		forecast.Points = append(forecast.Points, Point{
			HoursAhead:         hours,
			PredictedLatencyMs: predicted,
			// Uncertainty grows with the horizon; a 24h projection is not as
			// tight as a 1h one. Rough but honest: ~2 sigma, widened by sqrt(h).
			IntervalMs: 2 * residual * math.Sqrt(float64(hours)),
		})
	}
	forecast.Confidence, forecast.ConfidenceReason = confidence(len(yValues), forecast.RecentSuccessRate, residual, forecast.RSquared)
	return forecast, nil
}

func minMax(values []float64) (float64, float64) {
	if len(values) == 0 {
		return 0, 0
	}
	low, high := values[0], values[0]
	for _, value := range values {
		low = math.Min(low, value)
		high = math.Max(high, value)
	}
	return low, high
}

func median(values []float64) float64 {
	if len(values) == 0 {
		return 0
	}
	sorted := make([]float64, len(values))
	copy(sorted, values)
	sort.Float64s(sorted)
	middle := len(sorted) / 2
	if len(sorted)%2 == 0 {
		return (sorted[middle-1] + sorted[middle]) / 2
	}
	return sorted[middle]
}

// rSquared reports the share of variance the fitted line explains (0..1).
func rSquared(xValues, yValues []float64, intercept, slope float64) float64 {
	if len(yValues) < 2 {
		return 0
	}
	var mean float64
	for _, value := range yValues {
		mean += value
	}
	mean /= float64(len(yValues))

	var totalSS, residualSS float64
	for index := range yValues {
		totalSS += (yValues[index] - mean) * (yValues[index] - mean)
		residual := yValues[index] - (intercept + slope*xValues[index])
		residualSS += residual * residual
	}
	if totalSS == 0 {
		return 0 // every sample identical: nothing for a trend to explain
	}
	return math.Max(0, 1-residualSS/totalSS)
}

func fitLine(xValues, yValues []float64) (float64, float64) {
	if len(xValues) == 1 {
		return yValues[0], 0
	}
	var sumX, sumY, sumXY, sumXX float64
	for index := range xValues {
		sumX += xValues[index]
		sumY += yValues[index]
		sumXY += xValues[index] * yValues[index]
		sumXX += xValues[index] * xValues[index]
	}
	n := float64(len(xValues))
	denominator := n*sumXX - sumX*sumX
	if denominator == 0 {
		return sumY / n, 0
	}
	slope := (n*sumXY - sumX*sumY) / denominator
	return (sumY - slope*sumX) / n, slope
}

func residualStdDev(xValues, yValues []float64, intercept, slope float64) float64 {
	if len(yValues) < 2 {
		return 0
	}
	var total float64
	for index := range yValues {
		residual := yValues[index] - (intercept + slope*xValues[index])
		total += residual * residual
	}
	return math.Sqrt(total / float64(len(yValues)-1))
}

func confidence(sampleCount int, successRate, residual, rSquared float64) (string, string) {
	switch {
	case sampleCount < 6:
		return "low", "Fewer than six successful samples are available."
	case successRate < 0.9:
		return "low", "Recent connection failures reduce the reliability of a latency forecast."
	case sampleCount >= 30 && residual < 50 && rSquared >= 0.3:
		return "high", "Many recent successful samples, low variation, and a trend that explains most of it."
	case rSquared < 0.3:
		// Previously this case returned "medium", which lent unearned weight to
		// a slope fitted to noise.
		return "low", fmt.Sprintf(
			"Latency is too erratic for a trend to be meaningful (the line explains only %.0f%% of the variation), so the projection shown is the recent median rather than an extrapolation.",
			rSquared*100)
	default:
		return "medium", "The forecast is based on recent observations; network conditions can still change abruptly."
	}
}