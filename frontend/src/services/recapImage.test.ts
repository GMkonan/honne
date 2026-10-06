import { describe, expect, it, vi } from "vitest";
import { createMonthlyLogImage, monthlyLogFilename } from "./recapImage.ts";

const emptySummary = {
  entries: [],
  titles: 0,
  completed: 0,
  repeats: 0,
  startsAt: new Date(2026, 8, 1),
  endsAt: new Date(2026, 9, 1),
};

describe("Monthly Log image export", () => {
  it("uses a stable calendar-month filename", () => {
    expect(monthlyLogFilename(new Date(2026, 8, 1))).toBe(
      "honne-monthly-log-2026-09.png",
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
