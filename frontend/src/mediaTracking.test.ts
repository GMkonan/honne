import { describe, expect, it } from "vitest";
import {
  catalogTotalLabel,
  formatPlaytime,
  mediaStatusLabel,
  mediaTracking,
  normalizePersonalPlatforms,
  optionalNumberInputValue,
  playtimeHoursInputValue,
  playtimeMinutesFromHours,
} from "./mediaTracking.ts";

describe("media tracking rules", () => {
  it("uses episodes for anime and series", () => {
    for (const type of ["anime", "series"] as const) {
      expect(mediaTracking(type)).toMatchObject({
        tracksProgress: true,
        progressLabel: "Episodes watched",
        totalLabel: "Total episodes",
        unitPlural: "episodes",
        repeatLabel: "Rewatches",
      });
      expect(mediaStatusLabel("in_progress", type)).toBe("Watching");
    }
  });

  it("uses pages for books and chapters for manga and light novels", () => {
    expect(mediaTracking("book")).toMatchObject({
      progressLabel: "Pages read",
      totalLabel: "Total pages",
      unitPlural: "pages",
      repeatLabel: "Rereads",
    });
    for (const type of ["manga", "light_novel"] as const) {
      expect(mediaTracking(type)).toMatchObject({
        progressLabel: "Chapters read",
        totalLabel: "Total chapters",
        unitPlural: "chapters",
        repeatLabel: "Rereads",
      });
      expect(mediaStatusLabel("in_progress", type)).toBe("Reading");
    }
  });

  it("does not assign numeric tracking or catalog parts to movies", () => {
    expect(mediaTracking("movie")).toMatchObject({
      tracksProgress: false,
      repeatLabel: "Rewatches",
    });
    expect(catalogTotalLabel("movie", 1)).toBe("");
    expect(mediaStatusLabel("in_progress", "movie")).toBe("Watching");
  });

  it("uses game-specific status, replay, and playtime rules", () => {
    expect(mediaTracking("game")).toMatchObject({
      tracksProgress: false,
      plannedLabel: "Plan to play",
      inProgressLabel: "Playing",
      repeatLabel: "Replays",
    });
    expect(mediaStatusLabel("planned", "game")).toBe("Plan to play");
    expect(mediaStatusLabel("in_progress", "game")).toBe("Playing");
    expect(playtimeMinutesFromHours("1.5")).toBe(90);
    expect(playtimeMinutesFromHours("0.5")).toBe(30);
    expect(playtimeMinutesFromHours("")).toBe(0);
    expect(playtimeHoursInputValue(90)).toBe("1.5");
    expect(formatPlaytime(90)).toBe("1h 30m");
    expect(formatPlaytime(0)).toBe("Not tracked");
    expect(formatPlaytime(-1)).toBe("Not tracked");
    expect(normalizePersonalPlatforms(" PC, Switch, pc, ")).toEqual([
      "PC",
      "Switch",
    ]);
    expect(
      normalizePersonalPlatforms(
        Array.from({ length: 13 }, (_, index) => `Platform ${index}`).join(","),
      ),
    ).toHaveLength(13);
  });

  it("renders zero as an empty numeric input value", () => {
    expect(optionalNumberInputValue(0)).toBe("");
    expect(optionalNumberInputValue(10)).toBe(10);
  });

  it("keeps generic labels for mixed-type filters", () => {
    expect(mediaStatusLabel("planned", "all")).toBe("Planned");
    expect(mediaStatusLabel("in_progress", "all")).toBe("In progress");
  });
});
