import { describe, expect, it } from "vite-plus/test";
import {
  estimateRunningUsage,
  restoreRunningUsageHistory,
  runningUsageNotification,
  sampleRunningUsage,
  type RunningUsageReading,
} from "./runningUsage";

const start = Date.parse("2026-10-22T18:00:00Z");
const minute = 60_000;
const reading = (
  remainingPercent: number,
  checkedAt = start,
  overrides: Partial<RunningUsageReading> = {},
): RunningUsageReading => ({
  key: "codex/session",
  label: "Codex · Session",
  remainingPercent,
  checkedAt,
  cycle: "session-1",
  resetsAt: start + 5 * 60 * minute,
  ...overrides,
});

describe("running usage forecast", () => {
  it("measures consumption from observed samples and anchors exhaustion to the last reading", () => {
    const initial = reading(80);
    const latest = reading(70, start + 10 * minute);
    const history = sampleRunningUsage(
      sampleRunningUsage({}, [initial], start),
      [latest],
      latest.checkedAt,
    );
    const expected = { percentPerHour: 60, emptyAt: start + 80 * minute, status: "forecast" };
    expect(estimateRunningUsage(latest, history, latest.checkedAt)).toEqual(expected);
    expect(estimateRunningUsage(latest, history, latest.checkedAt + minute)).toEqual(expected);
    expect(runningUsageNotification(1, [latest], history, latest.checkedAt).body).toMatch(
      /^60\.0%\/h · Empty ~/,
    );
  });

  it("waits for enough evidence and never invents a rate from a single snapshot", () => {
    const current = reading(35);
    const history = sampleRunningUsage({}, [current], start);
    expect(estimateRunningUsage(current, history, start).status).toBe("learning");
    expect(estimateRunningUsage(current, history, start).emptyAt).toBeNull();
  });

  it("does not mix reset cycles, replenishment, or out-of-order snapshots", () => {
    const first = reading(40);
    const latest = reading(30, start + 5 * minute);
    let history = sampleRunningUsage({}, [first], start);
    history = sampleRunningUsage(history, [latest], latest.checkedAt);
    expect(
      sampleRunningUsage(history, [reading(90, start + 4 * minute)], latest.checkedAt),
    ).toEqual(history);
    const reset = reading(100, start + 6 * minute, { cycle: "session-2" });
    history = sampleRunningUsage(history, [reset], reset.checkedAt);
    expect(estimateRunningUsage(reset, history, reset.checkedAt).status).toBe("learning");
    const refill = reading(100, start + 7 * minute);
    expect(
      sampleRunningUsage(sampleRunningUsage({}, [first], start), [refill], refill.checkedAt)[
        first.key
      ]!.samples,
    ).toHaveLength(1);
  });

  it("reports no recent usage without projecting an artificial exhaustion time", () => {
    const latest = reading(50, start + 5 * minute);
    const history = sampleRunningUsage(
      sampleRunningUsage({}, [reading(50)], start),
      [latest],
      latest.checkedAt,
    );
    expect(estimateRunningUsage(latest, history, latest.checkedAt)).toEqual({
      percentPerHour: 0,
      emptyAt: null,
      status: "steady",
    });
  });

  it("pauses forecasts for stale or future data and drops idle history", () => {
    const latest = reading(40);
    const history = sampleRunningUsage({}, [latest], start);
    expect(estimateRunningUsage(latest, history, start + 4 * minute).status).toBe("stale");
    expect(estimateRunningUsage(reading(40, start + 2 * minute), history, start).status).toBe(
      "stale",
    );
    expect(sampleRunningUsage(history, [], start)).toEqual({});
    expect(sampleRunningUsage({}, [reading(Number.NaN)], start)).toEqual({});
  });

  it("shows a reset before exhaustion instead of extrapolating across refilled quota", () => {
    const latest = reading(79, start + 10 * minute, { resetsAt: start + 60 * minute });
    const history = sampleRunningUsage(
      sampleRunningUsage({}, [reading(80)], start),
      [latest],
      latest.checkedAt,
    );
    expect(estimateRunningUsage(latest, history, latest.checkedAt)).toEqual({
      percentPerHour: 6,
      emptyAt: null,
      status: "resetsFirst",
    });
  });

  it("keeps accounts independent, displays zero, and prioritizes the earliest exhaustion", () => {
    const codex = reading(0);
    const claude = reading(30, start, { key: "claude/session", label: "Claude · Session" });
    const notification = runningUsageNotification(3, [claude, codex], {}, start);
    expect(notification.title).toBe("3 threads running · 0% left");
    expect(notification.lines[0]).toContain("Codex · Session: 0% left");
    expect(notification.lines[1]).toContain("Measuring usage rate");
    expect(notification.progressPercent).toBe(0);
  });

  it("restores valid history and rejects broken persisted samples", () => {
    const history = sampleRunningUsage({}, [reading(50)], start);
    expect(restoreRunningUsageHistory(JSON.stringify(history))).toEqual(history);
    expect(restoreRunningUsageHistory("broken")).toEqual({});
    expect(
      restoreRunningUsageHistory('{"quota":{"cycle":"a","samples":[{"at":"oops","remaining":3}]}}'),
    ).toEqual({});
  });
});
