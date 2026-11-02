import { describe, expect, it } from "vitest";
import {
  completedGenreDistribution,
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
    const stats = completedGenreDistribution([
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
  });

  it("uses all completed titles as the denominator, including missing genres, and allows overlapping percentages", () => {
    const stats = completedGenreDistribution([
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
    const stats = completedGenreDistribution([
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
    const stats = completedGenreDistribution(
      [{ ...anime, status: "planned" }],
      "anime",
    );
    expect(stats.completedCount).toBe(0);
    expect(stats.genres).toEqual([]);
    expect(completedGenreDistribution([], "anime")).toEqual(stats);
  });

  it("does not display a rare nonzero genre as zero percent", () => {
    expect(genrePercentage(200 / 3)).toBe("67%");
    expect(genrePercentage(100)).toBe("100%");
    expect(genrePercentage(0.25)).toBe("<1%");
  });
});
