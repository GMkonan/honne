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

export function genrePercentage(value: number): string {
  return value > 0 && value < 1 ? "<1%" : `${Math.round(value)}%`;
}
