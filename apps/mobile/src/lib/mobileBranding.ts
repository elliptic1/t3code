export type MobileStageLabel = "Alpha" | "Dev" | "Nightly";

export function resolveMobileStageLabel(appVariant: unknown): MobileStageLabel {
  if (appVariant === "development") return "Dev";
  if (appVariant === "preview") return "Nightly";
  return "Alpha";
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-10-11 21:05" -> "Built Oct 11, 2026 · 9:05 PM"; null when the build carries no valid stamp. */
export function formatMobileBuildLabel(buildTimestamp: unknown): string | null {
  if (typeof buildTimestamp !== "string") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(buildTimestamp);
  if (!match) return null;
  const month = MONTHS[Number(match[2]) - 1];
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  if (!month || hour > 23 || minute > 59) return null;
  const clock = `${hour % 12 === 0 ? 12 : hour % 12}:${match[5]} ${hour < 12 ? "AM" : "PM"}`;
  return `Built ${month} ${Number(match[3])}, ${match[1]} \u00b7 ${clock}`;
}
