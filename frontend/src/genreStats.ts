import type { TrackingMediaType } from "./mediaTracking.ts";

export interface GenreStatsMedia {
  type: string;
  status: string;
  genres?: readonly string[];
  progress?: number;
  total?: number;
  catalogTotal?: number;
  repeatCount?: number;
  durationMinutes?: number;
  playtimeMinutes?: number;
}

export interface GenreShare {
  name: string;
  count: number;
  percentage: number;
}

export type StatisticsMediaType = TrackingMediaType | "all";

export function completedGenreDistribution(
  items: readonly GenreStatsMedia[],
  type: StatisticsMediaType,
) {
  const completed = items.filter((item) =>
    (type === "all" || item.type === type) && item.status === "completed"
  );
  const counts = new Map<string, { name: string; count: number }>();
  let taggedCount = 0;
  for (const item of completed) {
    const seen = new Set<string>();
    for (const genre of item.genres || []) {
      const name = genre.trim().replace(/\s+/gu, " ");
      const key = name.toLocaleLowerCase("en");
      if (!name || seen.has(key)) continue;
      seen.add(key);
      const entry = counts.get(key);
      counts.set(key, {
        name: entry?.name || name,
        count: (entry?.count || 0) + 1,
      });
    }
    if (seen.size) taggedCount++;
  }
  const genres: GenreShare[] = [...counts.values()].sort((a, b) =>
    b.count - a.count || a.name.localeCompare(b.name, "en")
  ).map((genre) => ({
    ...genre,
    percentage: genre.count / completed.length * 100,
  }));
  return { completedCount: completed.length, taggedCount, genres };
}

function recordedCount(value?: number): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : 0;
}

export function completedGenreStats(
  items: readonly GenreStatsMedia[],
  type: TrackingMediaType,
) {
  const completed = items.filter((item) =>
    item.type === type && item.status === "completed"
  );
  let unitCount = 0;
  let missingProgressCount = 0;
  let missingRepeatCount = 0;
  let estimatedMinutes = 0;
  let incompleteEstimateCount = 0;
  let playtimeMinutes = 0;
  let missingPlaytimeCount = 0;

  for (const item of completed) {
    if (type === "game") {
      const minutes = recordedCount(item.playtimeMinutes);
      playtimeMinutes += minutes;
      if (!minutes) missingPlaytimeCount++;
      continue;
    }

    const repeats = recordedCount(item.repeatCount);
    const progress = recordedCount(item.progress);
    const total = recordedCount(item.total) || recordedCount(item.catalogTotal);
    // Completion is a viewing for movies, but does not invent episode/page progress.
    const units = type === "movie" ? 1 + repeats : progress + repeats * total;
    unitCount += units;
    if (type !== "movie") {
      if (!progress) missingProgressCount++;
      if (repeats && !total) missingRepeatCount++;
    }
    if (type === "anime" || type === "series" || type === "movie") {
      const duration = recordedCount(item.durationMinutes);
      estimatedMinutes += units * duration;
      if (
        !duration || (type !== "movie" && (!progress || (repeats && !total)))
      ) {
        incompleteEstimateCount++;
      }
    }
  }

  return {
    ...completedGenreDistribution(completed, type),
    unitCount,
    missingProgressCount,
    missingRepeatCount,
    estimatedMinutes,
    incompleteEstimateCount,
    playtimeMinutes,
    missingPlaytimeCount,
  };
}

export function genrePercentage(value: number): string {
  return value > 0 && value < 1 ? "<1%" : `${Math.round(value)}%`;
}
