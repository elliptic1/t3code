export type MobileStageLabel = "Alpha" | "Dev" | "Nightly";

export function resolveMobileStageLabel(appVariant: unknown): MobileStageLabel {
  if (appVariant === "development") return "Dev";
  if (appVariant === "preview") return "Nightly";
  return "Alpha";
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-10-11" -> "Built Oct 11, 2026"; null when the build carries no valid date. */
export function formatMobileBuildLabel(buildDate: unknown): string | null {
  if (typeof buildDate !== "string") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(buildDate);
  const month = match ? MONTHS[Number(match[2]) - 1] : undefined;
  if (!match || !month) return null;
  return `Built ${month} ${Number(match[3])}, ${match[1]}`;
}
