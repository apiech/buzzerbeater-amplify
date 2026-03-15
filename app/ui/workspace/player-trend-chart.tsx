import type { PlayerTrendPayload } from "@/app/types";
import { StatCard } from "@/app/ui/primitives/stat-card";

type PlayerTrendChartProps = {
  history: PlayerTrendPayload["history"];
  formatCurrency: (value: number | null | undefined) => string;
  formatInjury: (value: number | null | undefined) => string;
  formatTimestamp: (value: string | null | undefined) => string;
};

export function PlayerTrendChart({
  history,
  formatCurrency,
  formatInjury,
  formatTimestamp,
}: PlayerTrendChartProps) {
  const width = 720;
  const height = 220;
  const padding = 20;
  const salarySeries = buildTrendSeries(history, (point) => point.salary, width, height, padding);
  const dmiSeries = buildTrendSeries(history, (point) => point.dmi, width, height, padding);

  return (
    <div className="grid gap-4">
      <div className="grid gap-3 rounded-card border border-black/5 bg-surface-strong p-4">
        <svg
          aria-label="Player trend chart"
          className="h-auto w-full"
          role="img"
          viewBox={`0 0 ${width} ${height}`}
        >
          <rect
            className="fill-white/90 stroke-black/8"
            height={height}
            rx="20"
            width={width}
            x="0"
            y="0"
          />
          <line
            className="stroke-black/15"
            strokeWidth="2"
            x1={padding}
            x2={width - padding}
            y1={height - padding}
            y2={height - padding}
          />
          {salarySeries ? (
            <polyline
              fill="none"
              points={salarySeries}
              stroke="var(--color-accent)"
              strokeWidth="4"
            />
          ) : null}
          {dmiSeries ? (
            <polyline
              fill="none"
              points={dmiSeries}
              stroke="var(--color-note)"
              strokeDasharray="8 6"
              strokeWidth="3"
            />
          ) : null}
        </svg>
        <div className="flex flex-wrap gap-2">
          <span className="inline-flex rounded-full bg-note-bg px-3 py-1.5 text-sm font-semibold text-note">
            Salary
          </span>
          <span className="inline-flex rounded-full bg-note-bg/80 px-3 py-1.5 text-sm font-semibold text-note">
            DMI
          </span>
        </div>
        <div className="grid gap-2 text-xs text-ink-muted sm:grid-cols-4">
          {history.map((point) => (
            <span key={point.weekKey ?? point.fetchedAt ?? "trend-point"}>
              {point.weekKey ?? formatTimestamp(point.fetchedAt)}
            </span>
          ))}
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-4">
        {history.slice(-4).reverse().map((point) => (
          <StatCard
            detail={`DMI ${point.dmi ?? "N/A"} • ${point.gameShape ?? "N/A"} • Injury ${formatInjury(point.injuryWeeks)}`}
            key={point.weekKey ?? point.fetchedAt ?? "snapshot"}
            label={point.weekKey ?? "Snapshot"}
            value={formatCurrency(point.salary)}
          />
        ))}
      </div>
    </div>
  );
}

function buildTrendSeries(
  history: PlayerTrendPayload["history"],
  readValue: (point: PlayerTrendPayload["history"][number]) => number | null,
  width: number,
  height: number,
  padding: number,
): string | null {
  const values = history
    .map((point) => readValue(point))
    .filter((value): value is number => value !== null);

  if (values.length < 2) {
    return null;
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const xStep = history.length > 1 ? (width - padding * 2) / (history.length - 1) : 0;
  const yRange = max - min || 1;

  return history
    .map((point, index) => {
      const value = readValue(point);
      if (value === null) {
        return null;
      }

      const x = padding + index * xStep;
      const y = height - padding - ((value - min) / yRange) * (height - padding * 2);
      return `${x},${y}`;
    })
    .filter((point): point is string => Boolean(point))
    .join(" ");
}
