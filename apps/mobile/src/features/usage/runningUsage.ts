import * as Schema from "effect/Schema";
import * as Option from "effect/Option";

const MINUTE = 60_000;
const LOOKBACK = 15 * MINUTE;
export const USAGE_READING_MAX_AGE = 3 * MINUTE;

export interface RunningUsageReading {
  readonly key: string;
  readonly label: string;
  readonly remainingPercent: number;
  readonly checkedAt: number;
  readonly cycle: string;
  readonly resetsAt: number | null;
}

const Sample = Schema.Struct({
  at: Schema.Finite,
  remaining: Schema.Number.check(Schema.isBetween({ minimum: 0, maximum: 100 })),
});
const History = Schema.Record(
  Schema.String,
  Schema.Struct({ cycle: Schema.String, samples: Schema.Array(Sample) }),
);
export type RunningUsageHistory = typeof History.Type;
const decodeHistory = Schema.decodeUnknownOption(History);

export function restoreRunningUsageHistory(json: string | null): RunningUsageHistory {
  try {
    return Option.getOrElse(decodeHistory(JSON.parse(json ?? "{}")), () => ({}));
  } catch {
    return {};
  }
}

export function sampleRunningUsage(
  history: RunningUsageHistory,
  readings: readonly RunningUsageReading[],
  now: number,
): RunningUsageHistory {
  // Nothing accumulates indefinitely while the monitor is idle or accounts change.
  const next: Record<string, (typeof History.Type)[string]> = {};
  for (const reading of readings) {
    if (
      !Number.isFinite(reading.remainingPercent) ||
      reading.remainingPercent < 0 ||
      reading.remainingPercent > 100 ||
      !Number.isFinite(reading.checkedAt) ||
      reading.checkedAt > now + MINUTE ||
      now - reading.checkedAt > USAGE_READING_MAX_AGE
    )
      continue;
    const stored = history[reading.key];
    const previous = (stored?.samples.at(-1)?.at ?? 0) <= now + MINUTE ? stored : undefined;
    const last = previous?.samples.at(-1);
    if (previous && last && reading.checkedAt < last.at) {
      next[reading.key] = previous;
      continue;
    }
    const reset =
      previous?.cycle !== reading.cycle ||
      (last !== undefined && reading.remainingPercent > last.remaining + 0.01);
    const samples = reset
      ? []
      : (previous?.samples ?? []).filter(
          (sample) => sample.at >= now - LOOKBACK && sample.at < reading.checkedAt,
        );
    next[reading.key] = {
      cycle: reading.cycle,
      samples: [...samples, { at: reading.checkedAt, remaining: reading.remainingPercent }].slice(
        -120,
      ),
    };
  }
  return next;
}

export function estimateRunningUsage(
  reading: RunningUsageReading,
  history: RunningUsageHistory,
  now: number,
) {
  if (now - reading.checkedAt > USAGE_READING_MAX_AGE || reading.checkedAt > now + MINUTE) {
    return { percentPerHour: null, emptyAt: null, status: "stale" as const };
  }
  if (reading.remainingPercent <= 0) {
    return { percentPerHour: null, emptyAt: reading.checkedAt, status: "exhausted" as const };
  }
  const samples =
    history[reading.key]?.cycle === reading.cycle
      ? history[reading.key]!.samples.filter((sample) => sample.at >= now - LOOKBACK)
      : [];
  const first = samples[0];
  const last = samples.at(-1);
  if (!first || !last || last.at - first.at < MINUTE) {
    return { percentPerHour: null, emptyAt: null, status: "learning" as const };
  }
  const percentPerHour = ((first.remaining - last.remaining) * 60 * MINUTE) / (last.at - first.at);
  if (percentPerHour <= 0) {
    return { percentPerHour: 0, emptyAt: null, status: "steady" as const };
  }
  // Project from the last actual reading; rerenders never move the deadline forward.
  const emptyAt = last.at + (last.remaining / percentPerHour) * 60 * MINUTE;
  const resetsFirst =
    reading.resetsAt !== null && reading.resetsAt > now && reading.resetsAt <= emptyAt;
  return {
    percentPerHour,
    emptyAt: resetsFirst ? null : emptyAt,
    status: resetsFirst ? ("resetsFirst" as const) : ("forecast" as const),
  };
}

export function runningUsageNotification(
  count: number,
  readings: readonly RunningUsageReading[],
  history: RunningUsageHistory,
  now: number,
) {
  const clock = (at: number) =>
    new Date(at).toLocaleString(undefined, {
      ...(new Date(at).toDateString() !== new Date(now).toDateString()
        ? { weekday: "short" as const, month: "short" as const, day: "numeric" as const }
        : {}),
      hour: "numeric",
      minute: "2-digit",
    });
  const rows = readings
    .map((reading) => {
      const estimate = estimateRunningUsage(reading, history, now);
      const rate =
        estimate.percentPerHour === null ? "" : ` · ${estimate.percentPerHour.toFixed(1)}%/h`;
      const detail =
        estimate.status === "stale"
          ? "Usage stale · reconnecting"
          : estimate.status === "exhausted"
            ? "Allowance used up"
            : estimate.status === "learning"
              ? "Measuring usage rate…"
              : estimate.status === "steady"
                ? "No recent usage"
                : estimate.status === "resetsFirst"
                  ? `Resets ${clock(reading.resetsAt!)} before projected empty`
                  : `Empty ~${clock(estimate.emptyAt!)}`;
      return {
        reading,
        estimate,
        text: `${reading.label}: ${Math.round(reading.remainingPercent)}% left${rate} · ${detail}`,
        summary: `${rate ? `${rate.slice(3)} · ` : ""}${detail} · ${reading.label}`,
      };
    })
    .sort(
      (a, b) =>
        Number(a.estimate.status === "stale") - Number(b.estimate.status === "stale") ||
        (a.estimate.emptyAt ?? Infinity) - (b.estimate.emptyAt ?? Infinity) ||
        a.reading.remainingPercent - b.reading.remainingPercent ||
        a.reading.key.localeCompare(b.reading.key),
    );
  const primary = rows.find((row) => row.estimate.status !== "stale");
  return {
    title: `${count} ${count === 1 ? "thread" : "threads"} running${primary ? ` · ${Math.round(primary.reading.remainingPercent)}% left` : ""}`,
    body: rows[0]?.summary ?? "Waiting for usage data…",
    lines: rows.map((row) => row.text),
    progressPercent: primary ? Math.round(primary.reading.remainingPercent) : null,
    updatedAt: now,
    activeCount: count,
  };
}
