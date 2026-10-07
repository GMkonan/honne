export type MonthlyLogMediaType =
  | "all"
  | "anime"
  | "series"
  | "movie"
  | "book"
  | "manga"
  | "light_novel"
  | "game";

export interface MonthlyLogMedia {
  id: number;
  title: string;
  type: string;
  status: string;
  rating: number;
  repeatCount: number;
  coverUrl: string;
  createdAt: string;
}

export interface MonthlyLogActivity {
  id: number;
  mediaId?: number;
  action: "added" | "updated" | "deleted" | "imported";
  changes: {
    fromStatus?: string;
    toStatus?: string;
    fromRepeatCount?: number;
    toRepeatCount?: number;
  };
  occurredAt: string;
}

export interface MonthlyLogEntry {
  media: MonthlyLogMedia;
  occurredAt: string;
  completed: boolean;
  repeats: number;
}

export interface MonthlyLogSummary {
  entries: MonthlyLogEntry[];
  titles: number;
  completed: number;
  repeats: number;
  startsAt: Date;
  endsAt: Date;
  mediaType: MonthlyLogMediaType;
}

export function previousCalendarMonth(now = new Date()): {
  startsAt: Date;
  endsAt: Date;
} {
  const startsAt = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const endsAt = new Date(now.getFullYear(), now.getMonth(), 1);
  endsAt.setMilliseconds(-1);
  return { startsAt, endsAt };
}

export function monthlyLogLabel(startsAt: Date): string {
  return new Intl.DateTimeFormat("en", {
    month: "long",
    year: "numeric",
  }).format(startsAt);
}

function dateInMonth(value: string, startsAt: Date, endsAt: Date): boolean {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp >= startsAt.getTime() &&
    timestamp <= endsAt.getTime();
}

function completedInActivity(activity: MonthlyLogActivity): boolean {
  if (activity.changes.toStatus !== "completed") return false;
  return activity.action !== "updated" ||
    activity.changes.fromStatus !== "completed";
}

function repeatIncrease(activity: MonthlyLogActivity): number {
  if (activity.changes.toRepeatCount === undefined) return 0;
  return Math.max(
    0,
    activity.changes.toRepeatCount -
      (activity.changes.fromRepeatCount || 0),
  );
}

export function buildMonthlyLog(
  media: MonthlyLogMedia[],
  activities: MonthlyLogActivity[],
  now = new Date(),
  mediaType: MonthlyLogMediaType = "all",
): MonthlyLogSummary {
  const { startsAt, endsAt } = previousCalendarMonth(now);
  const mediaByID = new Map(media.map((item) => [item.id, item]));
  const entriesByMedia = new Map<number, MonthlyLogEntry>();
  const completedMedia = new Set<number>();
  let repeats = 0;

  for (const activity of activities) {
    if (!dateInMonth(activity.occurredAt, startsAt, endsAt)) continue;
    const item = activity.mediaId ? mediaByID.get(activity.mediaId) : undefined;
    if (
      !item || activity.action === "deleted" ||
      (mediaType !== "all" && item.type !== mediaType)
    ) continue;
    const completed = completedInActivity(activity);
    const repeatCount = repeatIncrease(activity);
    if (!completed && repeatCount === 0) continue;
    if (completed) completedMedia.add(item.id);
    repeats += repeatCount;
    const previous = entriesByMedia.get(item.id);
    entriesByMedia.set(item.id, {
      media: item,
      occurredAt: !previous || Date.parse(activity.occurredAt) >
          Date.parse(previous.occurredAt)
        ? activity.occurredAt
        : previous.occurredAt,
      completed: completed || previous?.completed || false,
      repeats: repeatCount + (previous?.repeats || 0),
    });
  }

  const entries = [...entriesByMedia.values()].sort((left, right) =>
    Date.parse(right.occurredAt) - Date.parse(left.occurredAt) ||
    left.media.title.localeCompare(right.media.title)
  );
  return {
    entries: entries.slice(0, 30),
    titles: entries.length,
    completed: completedMedia.size,
    repeats,
    startsAt,
    endsAt,
    mediaType,
  };
}
