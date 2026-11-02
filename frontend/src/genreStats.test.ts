import { describe, expect, it } from "vitest";
import {
  completedGenreDistribution,
  completedGenreStats,
  genrePercentage,
  type GenreStatsMedia,
} from "./genreStats.ts";

const anime: GenreStatsMedia = {
  type: "anime",
  status: "completed",
  genres: ["Comedy", "Romance"],
  progress: 12,
  total: 12,
  durationMinutes: 24,
};

describe("Completed genre statistics", () => {
  it("combines completed genre counts across media types without combining consumption units", () => {
    const items = [
      anime,
      { ...anime, type: "game", genres: ["Action", "Comedy"] },
      { ...anime, type: "book", genres: undefined },
      { ...anime, type: "series", status: "planned", genres: ["Drama"] },
    ];
    const stats = completedGenreDistribution(items, "all");
    expect(stats.completedCount).toBe(3);
    expect(stats.taggedCount).toBe(2);
    expect(stats.genres.map(({ name }) => name)).toEqual([
      "Comedy",
      "Action",
      "Romance",
    ]);
    expect(stats.genres[0].percentage).toBeCloseTo(200 / 3);
    expect(stats).not.toHaveProperty("unitCount");
    expect(completedGenreDistribution(items, "anime").genres).toEqual([
      { name: "Comedy", count: 1, percentage: 100 },
      { name: "Romance", count: 1, percentage: 100 },
    ]);
    expect(completedGenreDistribution(items, "manga").genres).toEqual([]);
  });
  it("counts only completed titles of the selected type, once per genre regardless of rewatches", () => {
    const stats = completedGenreStats([
      { ...anime, repeatCount: 3 },
      ...["planned", "in_progress", "paused", "dropped"].map((status) => ({
        ...anime,
        status,
        genres: ["Action"],
      })),
      { ...anime, type: "manga", genres: ["Adventure"] },
    ], "anime");
    expect(stats.completedCount).toBe(1);
    expect(stats.genres).toEqual([
      { name: "Comedy", count: 1, percentage: 100 },
      { name: "Romance", count: 1, percentage: 100 },
    ]);
    expect(stats.unitCount).toBe(48);
  });

  it("uses all completed titles as the denominator, including missing genres, and allows overlapping percentages", () => {
    const stats = completedGenreStats([
      anime,
      { ...anime, genres: ["Comedy", "Action"] },
      { ...anime, genres: undefined },
    ], "anime");
    expect(stats.completedCount).toBe(3);
    expect(stats.taggedCount).toBe(2);
    expect(stats.genres.map((genre) => genre.name)).toEqual([
      "Comedy",
      "Action",
      "Romance",
    ]);
    expect(stats.genres[0].percentage).toBeCloseTo(200 / 3);
    expect(stats.genres.reduce((sum, genre) => sum + genre.percentage, 0))
      .toBeGreaterThan(100);
  });

  it("normalizes whitespace and case, deduplicates within a title, and resolves count ties alphabetically", () => {
    const stats = completedGenreStats([
      { ...anime, genres: [" Comedy ", "comedy", "", "  ", "Sci   Fi"] },
      { ...anime, genres: ["COMEDY", "sci fi", "Action"] },
    ], "anime");
    expect(stats.genres).toEqual([
      { name: "Comedy", count: 2, percentage: 100 },
      { name: "Sci Fi", count: 2, percentage: 100 },
      { name: "Action", count: 1, percentage: 50 },
    ]);
  });

  it("returns empty statistics without invalid percentages when nothing is completed", () => {
    const stats = completedGenreStats(
      [{ ...anime, status: "planned" }],
      "anime",
    );
    expect(stats.completedCount).toBe(0);
    expect(stats.genres).toEqual([]);
    expect(stats.unitCount).toBe(0);
    expect(stats.estimatedMinutes).toBe(0);
    expect(completedGenreStats([], "anime")).toEqual(stats);
  });

  it("uses recorded episode progress, personal totals for repeats, and catalog totals only as a fallback", () => {
    const stats = completedGenreStats([
      { ...anime, repeatCount: 2, catalogTotal: 24 },
      { ...anime, progress: 10, total: 0, catalogTotal: 10, repeatCount: 1 },
    ], "anime");
    expect(stats.unitCount).toBe(56);
    expect(stats.estimatedMinutes).toBe(56 * 24);
    expect(stats.missingRepeatCount).toBe(0);
    expect(stats.incompleteEstimateCount).toBe(0);
  });

  it("keeps partial estimates and reports missing progress, runtime, and unknown repeat lengths without inventing values", () => {
    const missing = Object.freeze({ ...anime, progress: 0 });
    const stats = completedGenreStats([
      anime,
      { ...anime, durationMinutes: undefined },
      missing,
      { ...anime, total: undefined, repeatCount: 2 },
    ], "anime");
    expect(stats.unitCount).toBe(36);
    expect(stats.estimatedMinutes).toBe(24 * 24);
    expect(stats.missingProgressCount).toBe(1);
    expect(stats.missingRepeatCount).toBe(1);
    expect(stats.incompleteEstimateCount).toBe(3);
    expect(missing.progress).toBe(0);
  });

  it("counts movie viewings from completion and rewatches, not synthetic episode progress", () => {
    const stats = completedGenreStats([
      {
        ...anime,
        type: "movie",
        progress: 0,
        durationMinutes: 120,
        repeatCount: 2,
      },
      { ...anime, type: "movie", durationMinutes: 0 },
    ], "movie");
    expect(stats.completedCount).toBe(2);
    expect(stats.unitCount).toBe(4);
    expect(stats.estimatedMinutes).toBe(360);
    expect(stats.incompleteEstimateCount).toBe(1);
    expect(stats.missingProgressCount).toBe(0);
  });

  it.each(["book", "manga", "light_novel", "series"] as const)(
    "includes recorded progress and known completed repeats for %s",
    (type) => {
      const stats = completedGenreStats([
        { ...anime, type, progress: 20, total: 20, repeatCount: 1 },
      ], type);
      expect(stats.unitCount).toBe(40);
      expect(stats.estimatedMinutes).toBe(type === "series" ? 960 : 0);
    },
  );

  it("sums recorded game playtime without multiplying cumulative hours by replays", () => {
    const stats = completedGenreStats([
      { ...anime, type: "game", playtimeMinutes: 90, repeatCount: 4 },
      { ...anime, type: "game", playtimeMinutes: 120 },
      { ...anime, type: "game", playtimeMinutes: 0 },
      { ...anime, type: "game", playtimeMinutes: 500, status: "in_progress" },
    ], "game");
    expect(stats.playtimeMinutes).toBe(210);
    expect(stats.missingPlaytimeCount).toBe(1);
    expect(stats.unitCount).toBe(0);
    expect(stats.estimatedMinutes).toBe(0);
  });

  it("does not turn invalid counters or runtimes into false estimates", () => {
    const stats = completedGenreStats([
      { ...anime, progress: NaN, repeatCount: Infinity, durationMinutes: -24 },
      { ...anime, progress: -1, total: -12, durationMinutes: Infinity },
      { ...anime, progress: 1.5, total: NaN, repeatCount: -1 },
    ], "anime");
    expect(stats.unitCount).toBe(0);
    expect(stats.estimatedMinutes).toBe(0);
    expect(stats.missingProgressCount).toBe(3);
    expect(stats.incompleteEstimateCount).toBe(3);
  });

  it("does not display a rare nonzero genre as zero percent", () => {
    expect(genrePercentage(200 / 3)).toBe("67%");
    expect(genrePercentage(100)).toBe("100%");
    expect(genrePercentage(0.25)).toBe("<1%");
  });
});
