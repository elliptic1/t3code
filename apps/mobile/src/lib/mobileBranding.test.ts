import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { formatMobileBuildLabel } from "./mobileBranding";

describe("formatMobileBuildLabel", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("converts the build instant into the device timezone", () => {
    vi.stubEnv("TZ", "America/New_York");
    expect(formatMobileBuildLabel("2026-10-14T01:05:00.000Z")).toBe("Built Oct 13, 2026, 9:05 PM");
    vi.stubEnv("TZ", "UTC");
    expect(formatMobileBuildLabel("2026-10-14T01:05:00.000Z")).toBe("Built Oct 14, 2026, 1:05 AM");
  });
  it("formats the local build date and 12-hour time", () => {
    expect(formatMobileBuildLabel("2026-10-11 21:05")).toBe("Built Oct 11, 2026 \u00b7 9:05 PM");
    expect(formatMobileBuildLabel("2026-01-05 00:07")).toBe("Built Jan 5, 2026 \u00b7 12:07 AM");
    expect(formatMobileBuildLabel("2026-01-05 12:00")).toBe("Built Jan 5, 2026 \u00b7 12:00 PM");
  });

  it("returns null when the build has no valid stamp", () => {
    for (const value of [
      undefined,
      null,
      42,
      "",
      "2026-10-11",
      "2026-13-01 10:00",
      "2026-10-11 24:00",
      "2026-10-11 10:60",
    ]) {
      expect(formatMobileBuildLabel(value)).toBeNull();
    }
  });
});
