import { describe, expect, it } from "vitest";
import {
  catalogTotalLabel,
  mediaStatusLabel,
  mediaTracking,
  optionalNumberInputValue,
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

  it("renders zero as an empty numeric input value", () => {
    expect(optionalNumberInputValue(0)).toBe("");
    expect(optionalNumberInputValue(10)).toBe(10);
  });

  it("keeps generic labels for mixed-type filters", () => {
    expect(mediaStatusLabel("planned", "all")).toBe("Plan to read/watch");
    expect(mediaStatusLabel("in_progress", "all")).toBe("In progress");
  });
});
