import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { LatencySample } from "../api";
import { EmptyState } from "./Loaders";

interface Props {
  samples: LatencySample[];
}

export default function LatencyChart({ samples }: Props) {
  if (samples.length === 0) {
    return (
      <EmptyState
        title="No latency samples in this window."
        hint="The collector times a TCP handshake every 30 seconds — try a wider range, or wait for the next tick."
      />
    );
  }

  const data = samples.map((s) => ({
    time: new Date(s.captured_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    latency: s.success ? Math.round(s.latency_ms * 10) / 10 : null,
    failed: !s.success,
  }));

  const failures = samples.filter((s) => !s.success).length;
  const values = samples.filter((s) => s.success).map((s) => s.latency_ms);
  const avg = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
  const min = values.length ? Math.min(...values) : 0;
  const max = values.length ? Math.max(...values) : 0;

  return (
    <div>
      {/* Summary stats carry the reading on mobile, where the plot is too small
          to judge precise values from. */}
      <dl className="mb-3 grid grid-cols-3 gap-2 border-b border-line/60 pb-3">
        {[
          { label: "avg", value: avg },
          { label: "min", value: min },
          { label: "max", value: max },
        ].map((stat) => (
          <div key={stat.label}>
            <dt className="font-mono text-[10px] uppercase tracking-wider text-muted">{stat.label}</dt>
            <dd className="mt-0.5 font-mono text-sm text-ink sm:text-base">
              {Math.round(stat.value)}
              <span className="ml-0.5 text-[10px] text-muted">ms</span>
            </dd>
          </div>
        ))}
      </dl>

      {/* Height steps up with the viewport — a fixed 220px is cramped on a
          phone and wasteful on a desktop. */}
      <div className="h-[180px] w-full sm:h-[220px] lg:h-[260px]">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
            <defs>
              <linearGradient id="latencyFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#5EEAD4" stopOpacity={0.35} />
                <stop offset="100%" stopColor="#5EEAD4" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="#26302F" strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="time"
              tick={{ fill: "#728583", fontSize: 10 }}
              axisLine={{ stroke: "#26302F" }}
              tickLine={false}
              minTickGap={24}
            />
            <YAxis
              tick={{ fill: "#728583", fontSize: 10 }}
              axisLine={{ stroke: "#26302F" }}
              tickLine={false}
              unit="ms"
              width={46}
            />
            <Tooltip
              contentStyle={{
                background: "rgba(18,24,26,0.95)",
                border: "1px solid #26302F",
                borderRadius: 8,
                fontSize: 12,
                boxShadow: "0 8px 24px -12px rgba(0,0,0,0.8)",
              }}
              labelStyle={{ color: "#728583" }}
              cursor={{ stroke: "#5EEAD4", strokeWidth: 1, strokeDasharray: "3 3" }}
              animationDuration={150}
            />
            <Area
              type="monotone"
              dataKey="latency"
              stroke="#5EEAD4"
              strokeWidth={2}
              fill="url(#latencyFill)"
              connectNulls
              activeDot={{ r: 4, fill: "#5EEAD4", stroke: "#0B0F0E", strokeWidth: 2 }}
              animationDuration={600}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {failures > 0 && (
        <p className="animate-fade-in mt-2 flex items-center gap-1.5 font-mono text-xs text-danger">
          <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-danger" />
          {failures} failed connection attempt{failures === 1 ? "" : "s"} in this window
        </p>
      )}
    </div>
  );
}
