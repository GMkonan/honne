export type TrackingMediaType =
  | "anime"
  | "series"
  | "movie"
  | "book"
  | "manga"
  | "light_novel";

export type TrackingMediaStatus =
  | "planned"
  | "in_progress"
  | "completed"
  | "paused"
  | "dropped";

interface MediaTrackingDefinition {
  tracksProgress: boolean;
  progressLabel: string;
  totalLabel: string;
  unitLabel: string;
  unitPlural: string;
  plannedLabel: string;
  inProgressLabel: string;
  repeatLabel: string;
  repeatHelp: string;
}

const rewatchHelp = "Additional completed viewings after the first.";
const rereadHelp = "Additional completed readings after the first.";

function tracked(unitLabel: string, reading: boolean): MediaTrackingDefinition {
  const unitPlural = unitLabel.toLowerCase();
  return {
    tracksProgress: true,
    progressLabel: `${unitLabel} ${reading ? "read" : "watched"}`,
    totalLabel: `Total ${unitPlural}`,
    unitLabel,
    unitPlural,
    plannedLabel: reading ? "Plan to read" : "Plan to watch",
    inProgressLabel: reading ? "Reading" : "Watching",
    repeatLabel: reading ? "Rereads" : "Rewatches",
    repeatHelp: reading ? rereadHelp : rewatchHelp,
  };
}

const trackingByType: Record<TrackingMediaType, MediaTrackingDefinition> = {
  anime: tracked("Episodes", false),
  series: tracked("Episodes", false),
  movie: {
    ...tracked("Progress", false),
    tracksProgress: false,
    progressLabel: "",
    totalLabel: "",
    unitPlural: "",
  },
  book: tracked("Pages", true),
  manga: tracked("Chapters", true),
  light_novel: tracked("Chapters", true),
};

export function mediaTracking(
  type: TrackingMediaType,
): MediaTrackingDefinition {
  return trackingByType[type];
}

export function mediaStatusLabel(
  status?: TrackingMediaStatus,
  type: TrackingMediaType | "all" = "all",
): string {
  if (!status) return "Unknown";
  if (type !== "all") {
    const tracking = mediaTracking(type);
    if (status === "planned") return tracking.plannedLabel;
    if (status === "in_progress") return tracking.inProgressLabel;
  }
  if (status === "planned") return "Plan to read/watch";
  if (status === "in_progress") return "In progress";
  if (status === "completed") return "Completed";
  if (status === "paused") return "Paused";
  return "Dropped";
}

export function progressValue(progress: number, total: number): string {
  if (total > 0) return `${progress} of ${total}`;
  return progress > 0 ? String(progress) : "Not started";
}

export function optionalNumberInputValue(value: number): number | "" {
  return value === 0 ? "" : value;
}

export function catalogTotalLabel(
  type: TrackingMediaType,
  total: number,
): string {
  const tracking = mediaTracking(type);
  return tracking.tracksProgress ? `${total} ${tracking.unitPlural}` : "";
}
