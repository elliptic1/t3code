export type MobileStageLabel = "Alpha" | "Dev" | "Nightly";

export function resolveMobileStageLabel(appVariant: unknown): MobileStageLabel {
  if (appVariant === "development") return "Dev";
  if (appVariant === "preview") return "Nightly";
  return "Alpha";
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Display the embedded build instant in the device timezone; accept older local stamps too. */
export function formatMobileBuildLabel(buildTimestamp: unknown): string | null {
  if (typeof buildTimestamp !== "string") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(buildTimestamp);
  if (!match) {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(buildTimestamp)) return null;
    const date = new Date(buildTimestamp);
    if (Number.isNaN(date.getTime())) return null;
    return `Built ${date.toLocaleString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    })}`;
  }
  const month = MONTHS[Number(match[2]) - 1];
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  if (!month || hour > 23 || minute > 59) return null;
  const clock = `${hour % 12 === 0 ? 12 : hour % 12}:${match[5]} ${hour < 12 ? "AM" : "PM"}`;
  return `Built ${month} ${Number(match[3])}, ${match[1]} \u00b7 ${clock}`;
}
