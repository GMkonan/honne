import { describe, expect, it } from "vitest";
import { seasonProgressOptions } from "./seasonProgress.ts";

function season(seasonNumber: number, episodeCount?: number) {
  return {
    seasonNumber,
    episodeCount,
    completed: true,
    providerId: "1",
    title: "Season",
  };
}

describe("season progress", () => {
  it("sums sequential seasons in order and excludes specials", () => {
    expect(seasonProgressOptions([
      season(3, 16),
      season(0, 99),
      season(1, 12),
      season(2, 13),
    ])).toEqual([
      { seasons: 1, episodes: 12 },
      { seasons: 2, episodes: 25 },
      { seasons: 3, episodes: 41 },
    ]);
  });

  it("never skips gaps or unknown episode counts", () => {
    for (const invalid of [undefined, 0, -1, 1.5, NaN]) {
      expect(seasonProgressOptions([
        season(1, 12),
        season(2, invalid),
        season(3, 16),
      ])).toEqual([{ seasons: 1, episodes: 12 }]);
    }
    expect(seasonProgressOptions([season(1, 12), season(3, 16)]))
      .toEqual([{ seasons: 1, episodes: 12 }]);
    expect(seasonProgressOptions([season(2, 13)])).toEqual([]);
    expect(seasonProgressOptions([])).toEqual([]);
  });

  it("stops before an ongoing or unconfirmed season even when it has a planned count", () => {
    for (const completed of [false, undefined]) {
      expect(seasonProgressOptions([
        season(1, 12),
        { ...season(2, 13), completed },
        season(3, 16),
      ])).toEqual([{ seasons: 1, episodes: 12 }]);
    }
    expect(seasonProgressOptions([
      season(1, Number.MAX_SAFE_INTEGER),
      season(2, 1),
    ])).toEqual([{ seasons: 1, episodes: Number.MAX_SAFE_INTEGER }]);
  });
});
