import { describe, expect, it } from "vite-plus/test";

import { formatMobileBuildLabel } from "./mobileBranding";

describe("formatMobileBuildLabel", () => {
  it("formats an ISO build day without timezone drift", () => {
    expect(formatMobileBuildLabel("2026-10-11")).toBe("Built Oct 11, 2026");
    expect(formatMobileBuildLabel("2026-01-05")).toBe("Built Jan 5, 2026");
  });

  it("returns null when the build has no valid date", () => {
    for (const value of [
      undefined,
      null,
      42,
      "",
      "2026-13-01",
      "10/11/2026",
      "2026-10-11T00:00Z",
    ]) {
      expect(formatMobileBuildLabel(value)).toBeNull();
    }
  });
});
