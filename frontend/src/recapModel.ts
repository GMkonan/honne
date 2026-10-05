export type RecapPeriod = "week" | "month" | "year";
export type RecapFocus = "finished" | "added";
export type RecapSort = "recent" | "rating";

export interface RecapMedia {
  id: number;
  title: string;
  type: string;
  status: string;
  rating: number;
  repeatCount: number;
  coverUrl: string;
  createdAt: string;
}

export interface RecapActivity {
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

export interface RecapEntry {
  media: RecapMedia;
  occurredAt: string;
  completed: boolean;
  repeats: number;
}

export interface RecapSummary {
  entries: RecapEntry[];
  completed: number;
  repeats: number;
  added: number;
  startsAt: Date;
}

const periodDays: Record<RecapPeriod, number> = {
  week: 7,
  month: 30,
  year: 365,
};

export function recapPeriodLabel(period: RecapPeriod): string {
  if (period === "week") return "Last 7 days";
  if (period === "month") return "Last 30 days";
  return "Last 365 days";
}

function dateInPeriod(value: string, startsAt: Date, now: Date): boolean {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp >= startsAt.getTime() &&
    timestamp <= now.getTime();
}

function completedInActivity(activity: RecapActivity): boolean {
  if (activity.changes.toStatus !== "completed") return false;
  return activity.action !== "updated" ||
    activity.changes.fromStatus !== "completed";
}

function repeatIncrease(activity: RecapActivity): number {
  if (activity.changes.toRepeatCount === undefined) return 0;
  return Math.max(
    0,
    activity.changes.toRepeatCount -
      (activity.changes.fromRepeatCount || 0),
  );
}

export function buildRecapSummary(
  media: RecapMedia[],
  activities: RecapActivity[],
  period: RecapPeriod,
  focus: RecapFocus,
  sort: RecapSort,
  now = new Date(),
): RecapSummary {
  const startsAt = new Date(now.getTime() - periodDays[period] * 86_400_000);
  const mediaByID = new Map(media.map((item) => [item.id, item]));
  const relevantActivities = activities.filter((activity) =>
    dateInPeriod(activity.occurredAt, startsAt, now)
  );
  const consumed = new Map<number, RecapEntry>();
  const completedMedia = new Set<number>();
  let repeats = 0;

  for (const activity of relevantActivities) {
    const item = activity.mediaId ? mediaByID.get(activity.mediaId) : undefined;
    if (!item || activity.action === "deleted") continue;
    const completed = completedInActivity(activity);
    const repeatCount = repeatIncrease(activity);
    if (!completed && repeatCount === 0) continue;
    if (completed) completedMedia.add(item.id);
    repeats += repeatCount;
    const previous = consumed.get(item.id);
    consumed.set(item.id, {
      media: item,
      occurredAt: !previous || Date.parse(activity.occurredAt) >
          Date.parse(previous.occurredAt)
        ? activity.occurredAt
        : previous.occurredAt,
      completed: completed || previous?.completed || false,
      repeats: repeatCount + (previous?.repeats || 0),
    });
  }

  const addedEntries = media.filter((item) =>
    dateInPeriod(item.createdAt, startsAt, now)
  ).map((item) => ({
    media: item,
    occurredAt: item.createdAt,
    completed: false,
    repeats: 0,
  }));
  const entries = focus === "finished" ? [...consumed.values()] : addedEntries;
  entries.sort((left, right) => {
    if (sort === "rating") {
      const ratingOrder = right.media.rating - left.media.rating;
      if (ratingOrder !== 0) return ratingOrder;
    }
    return Date.parse(right.occurredAt) - Date.parse(left.occurredAt) ||
      left.media.title.localeCompare(right.media.title);
  });

  return {
    entries: entries.slice(0, 6),
    completed: completedMedia.size,
    repeats,
    added: addedEntries.length,
    startsAt,
  };
}
