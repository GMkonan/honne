import { describe, expect, it, vi } from "vitest";
import { createRecapImage, recapFilename } from "./recapImage.ts";

const emptySummary = {
  entries: [],
  completed: 0,
  repeats: 0,
  added: 0,
  startsAt: new Date("2026-09-05T00:00:00Z"),
};

describe("recap image export", () => {
  it("uses stable period and story filenames", () => {
    expect(recapFilename("week", "finished")).toBe(
      "honne-finished-07-days.png",
    );
    expect(recapFilename("month", "added")).toBe(
      "honne-added-30-days.png",
    );
    expect(recapFilename("year", "finished")).toBe(
      "honne-finished-365-days.png",
    );
  });

  it("reports browsers without a canvas context", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    await expect(createRecapImage({
      summary: emptySummary,
      period: "month",
      focus: "finished",
      profileName: "My Library",
      now: new Date("2026-10-05T00:00:00Z"),
    })).rejects.toThrow("Image generation is unavailable");
  });
});
