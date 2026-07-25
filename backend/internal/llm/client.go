package llm

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"

	"netlapse/internal/investigator"
)

// Client sends structured investigator findings to an OpenAI-compatible chat endpoint.
type Client struct {
	endpoint string
	apiKey   string
	model    string
	http     *http.Client
}

type message struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type chatRequest struct {
	Model       string    `json:"model"`
	Messages    []message `json:"messages"`
	Temperature float64   `json:"temperature"`
}

type chatResponse struct {
	Choices []struct {
		Message message `json:"message"`
	} `json:"choices"`
}

// NewFromEnv returns a client only when NC_LLM_ENABLED is true.
// By default it targets Ollama's OpenAI-compatible endpoint with llama3.2.
func NewFromEnv() *Client {
	if !strings.EqualFold(os.Getenv("NC_LLM_ENABLED"), "true") {
		return nil
	}
	endpoint := os.Getenv("NC_LLM_URL")
	if endpoint == "" {
		endpoint = "http://localhost:11434/v1/chat/completions"
	}
	model := os.Getenv("NC_LLM_MODEL")
	if model == "" {
		model = "llama3.2"
	}
	return &Client{
		endpoint: endpoint,
		apiKey:   os.Getenv("NC_LLM_API_KEY"),
		model:    model,
		http:     &http.Client{Timeout: 20 * time.Second},
	}
}

// Model returns the configured model identifier.
func (c *Client) Model() string {
	return c.model
}

// Summarize creates a concise incident narrative from the investigator's findings.
func (c *Client) Summarize(ctx context.Context, report investigator.Report) (string, error) {
	facts, err := json.Marshal(report.Findings)
	if err != nil {
		return "", fmt.Errorf("encode findings: %w", err)
	}
	payload, err := json.Marshal(chatRequest{
		Model: c.model,
		Messages: []message{
			{Role: "system", Content: "You are a network incident analyst. Write a concise 2-4 sentence summary using only the supplied findings. Do not invent facts, causes, timestamps, or metrics. State uncertainty when evidence is limited."},
			{Role: "user", Content: fmt.Sprintf("Domain: %s\nFindings: %s", report.Domain, facts)},
		},
		Temperature: 0.2,
	})
	if err != nil {
		return "", fmt.Errorf("encode chat request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.endpoint, bytes.NewReader(payload))
	if err != nil {
		return "", fmt.Errorf("create chat request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	if c.apiKey != "" {
		req.Header.Set("Authorization", "Bearer "+c.apiKey)
	}

	response, err := c.http.Do(req)
	if err != nil {
		return "", fmt.Errorf("call model: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return "", fmt.Errorf("model returned %s", response.Status)
	}

	var decoded chatResponse
	if err := json.NewDecoder(response.Body).Decode(&decoded); err != nil {
		return "", fmt.Errorf("decode model response: %w", err)
	}
	if len(decoded.Choices) == 0 || strings.TrimSpace(decoded.Choices[0].Message.Content) == "" {
		return "", fmt.Errorf("model returned no completion")
	}
	return strings.TrimSpace(decoded.Choices[0].Message.Content), nil
}

