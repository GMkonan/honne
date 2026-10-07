import { describe, expect, it, vi } from "vitest";
import {
  createMonthlyLogImage,
  monthlyLogFilename,
} from "./monthlyLogImage.ts";

const emptySummary = {
  entries: [],
  titles: 0,
  completed: 0,
  repeats: 0,
  startsAt: new Date(2026, 8, 1),
  endsAt: new Date(2026, 9, 1),
  mediaType: "all" as const,
};

describe("Monthly Log image export", () => {
  it("uses a stable calendar-month filename", () => {
    expect(monthlyLogFilename(new Date(2026, 8, 1))).toBe(
      "honne-monthly-log-2026-09.png",
    );
  });

  it("identifies a filtered media type in the filename", () => {
    expect(monthlyLogFilename(new Date(2026, 8, 1), "light_novel")).toBe(
      "honne-monthly-log-2026-09-light-novel.png",
    );
  });

  it("reports browsers without a canvas context", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    await expect(createMonthlyLogImage({
      summary: emptySummary,
      profileName: "My Library",
    })).rejects.toThrow("Image generation is unavailable");
  });
});
