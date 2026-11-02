import { describe, expect, it } from "vitest";
import { consumptionStats } from "./consumptionStats.ts";
import type { GenreStatsMedia } from "./genreStats.ts";

const anime: GenreStatsMedia = {
  type: "anime",
  status: "completed",
  progress: 12,
  total: 12,
  durationMinutes: 24,
};

describe("Consumption statistics", () => {
  it.each(["anime", "series", "manga", "light_novel", "book"] as const)(
    "counts 1,000 recorded units of an ongoing %s, not its 1,500 available units",
    (type) => {
      const stats = consumptionStats([
        { ...anime, type, status: "in_progress", progress: 1000, total: 1500 },
      ], type);
      expect(stats.titleCount).toBe(1);
      expect(stats.completedCount).toBe(0);
      expect(stats.unitCount).toBe(1000);
      expect(stats.inferredProgressCount).toBe(0);
      expect(stats.estimatedMinutes).toBe(
        type === "anime" || type === "series" ? 24000 : 0,
      );
    },
  );

  it.each(["completed", "in_progress", "paused", "dropped", "planned"])(
    "retains recorded progress when a title is %s",
    (status) => {
      const stats = consumptionStats(
        [{ ...anime, status, progress: 5 }],
        "anime",
      );
      expect(stats.titleCount).toBe(1);
      expect(stats.unitCount).toBe(5);
      expect(stats.estimatedMinutes).toBe(120);
    },
  );

  it("does not infer consumption for unstarted titles, other media, or an empty selection", () => {
    const stats = consumptionStats([
      ...["planned", "in_progress", "paused", "dropped"].map((status) => ({
        ...anime,
        status,
        progress: 0,
        catalogTotal: 1500,
      })),
      { ...anime, type: "manga", progress: 1000 },
    ], "anime");
    expect(stats).toEqual(consumptionStats([], "anime"));
    expect(stats.titleCount).toBe(0);
    expect(stats.estimatedMinutes).toBe(0);
    expect(stats.unitCount).toBe(0);
  });

  it("infers missing completed progress from personal totals first and catalog totals second without changing saved data", () => {
    const personal = Object.freeze({
      ...anime,
      progress: 0,
      catalogTotal: 24,
      repeatCount: 1,
    });
    const catalog = Object.freeze({
      ...anime,
      progress: undefined,
      total: 0,
      catalogTotal: 10,
    });
    const stats = consumptionStats(Object.freeze([personal, catalog]), "anime");
    expect(stats.unitCount).toBe(34);
    expect(stats.inferredProgressCount).toBe(2);
    expect(stats.missingProgressCount).toBe(0);
    expect(stats.estimatedMinutes).toBe(34 * 24);
    expect(stats.incompleteEstimateCount).toBe(0);
    expect(personal.progress).toBe(0);
    expect(catalog.progress).toBeUndefined();
  });

  it("preserves explicit partial progress even on a completed title", () => {
    const stats = consumptionStats([
      { ...anime, progress: 3, total: 12, catalogTotal: 24, repeatCount: 1 },
    ], "anime");
    expect(stats.unitCount).toBe(15);
    expect(stats.inferredProgressCount).toBe(0);
  });

  it.each(["book", "manga", "light_novel", "series"] as const)(
    "includes recorded progress and known completed repeats for %s",
    (type) => {
      const stats = consumptionStats([
        { ...anime, type, progress: 20, total: 20, repeatCount: 1 },
      ], type);
      expect(stats.unitCount).toBe(40);
      expect(stats.estimatedMinutes).toBe(type === "series" ? 960 : 0);
    },
  );

  it("uses personal totals for repeats and catalog totals only as a fallback across statuses", () => {
    const stats = consumptionStats([
      { ...anime, repeatCount: 2, catalogTotal: 24 },
      {
        ...anime,
        status: "paused",
        progress: 10,
        total: 0,
        catalogTotal: 10,
        repeatCount: 1,
      },
    ], "anime");
    expect(stats.unitCount).toBe(56);
    expect(stats.estimatedMinutes).toBe(56 * 24);
    expect(stats.missingRepeatCount).toBe(0);
  });

  it("retains partial estimates and reports unknown progress, runtime, and repeat lengths without guessing", () => {
    const stats = consumptionStats([
      anime,
      { ...anime, status: "in_progress", durationMinutes: undefined },
      { ...anime, progress: 0, total: 0 },
      { ...anime, status: "dropped", total: undefined, repeatCount: 2 },
    ], "anime");
    expect(stats.unitCount).toBe(36);
    expect(stats.estimatedMinutes).toBe(24 * 24);
    expect(stats.missingProgressCount).toBe(1);
    expect(stats.missingRepeatCount).toBe(1);
    expect(stats.incompleteEstimateCount).toBe(3);
  });

  it("counts movie viewings from completion and rewatches, never synthetic episode progress or a planned runtime", () => {
    const movie = {
      ...anime,
      type: "movie",
      progress: 0,
      durationMinutes: 120,
    };
    const stats = consumptionStats([
      { ...movie, repeatCount: 2 },
      { ...movie, durationMinutes: 0 },
      { ...movie, status: "in_progress", repeatCount: 1 },
      { ...movie, status: "in_progress", progress: 999 },
      { ...movie, status: "planned" },
    ], "movie");
    expect(stats.titleCount).toBe(3);
    expect(stats.completedCount).toBe(2);
    expect(stats.unitCount).toBe(6);
    expect(stats.estimatedMinutes).toBe(600);
    expect(stats.incompleteEstimateCount).toBe(1);
    expect(stats.missingProgressCount).toBe(0);
    expect(stats.inferredProgressCount).toBe(0);
  });

  it("includes cumulative game playtime across statuses without multiplying by replays or using catalog runtimes", () => {
    const game = { ...anime, type: "game", progress: 0 };
    const stats = consumptionStats([
      { ...game, playtimeMinutes: 90, repeatCount: 4 },
      { ...game, status: "in_progress", playtimeMinutes: 120 },
      { ...game, status: "paused", playtimeMinutes: 500 },
      { ...game, status: "dropped", playtimeMinutes: 15 },
      { ...game, status: "planned", playtimeMinutes: 60 },
      { ...game, playtimeMinutes: 0 },
      { ...game, status: "in_progress", playtimeMinutes: 0 },
    ], "game");
    expect(stats.titleCount).toBe(6);
    expect(stats.completedCount).toBe(2);
    expect(stats.playtimeMinutes).toBe(785);
    expect(stats.missingPlaytimeCount).toBe(1);
    expect(stats.unitCount).toBe(0);
    expect(stats.inferredProgressCount).toBe(0);
    expect(stats.estimatedMinutes).toBe(0);
  });

  it("does not turn invalid counters or runtimes into false estimates", () => {
    const stats = consumptionStats([
      { ...anime, progress: NaN, repeatCount: Infinity, durationMinutes: -24 },
      { ...anime, progress: -1, total: -12, durationMinutes: Infinity },
      { ...anime, progress: 1.5, total: NaN, repeatCount: -1 },
      { ...anime, status: "planned", progress: Infinity },
    ], "anime");
    expect(stats.titleCount).toBe(3);
    expect(stats.unitCount).toBe(0);
    expect(stats.estimatedMinutes).toBe(0);
    expect(stats.inferredProgressCount).toBe(0);
    expect(stats.missingProgressCount).toBe(3);
    expect(stats.incompleteEstimateCount).toBe(3);
  });
});
