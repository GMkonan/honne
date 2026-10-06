import { describe, expect, it } from "vitest";
import {
  buildMonthlyLog,
  type MonthlyLogActivity,
  monthlyLogLabel,
  type MonthlyLogMedia,
} from "./recapModel.ts";

const now = new Date(2026, 9, 5, 12);
const media: MonthlyLogMedia[] = [
  {
    id: 1,
    title: "Arrival",
    type: "movie",
    status: "completed",
    rating: 9,
    repeatCount: 1,
    coverUrl: "https://example.com/arrival.jpg",
    createdAt: "2026-09-20T12:00:00Z",
  },
  {
    id: 2,
    title: "Dune",
    type: "book",
    status: "completed",
    rating: 10,
    repeatCount: 0,
    coverUrl: "",
    createdAt: "2026-10-03T12:00:00Z",
  },
];

const activities: MonthlyLogActivity[] = [
  {
    id: 1,
    mediaId: 1,
    action: "updated",
    changes: { fromStatus: "in_progress", toStatus: "completed" },
    occurredAt: "2026-09-25T12:00:00Z",
  },
  {
    id: 2,
    mediaId: 1,
    action: "updated",
    changes: { fromRepeatCount: 0, toRepeatCount: 1 },
    occurredAt: "2026-09-28T12:00:00Z",
  },
  {
    id: 3,
    mediaId: 2,
    action: "added",
    changes: { toStatus: "completed" },
    occurredAt: "2026-10-03T12:00:00Z",
  },
];

describe("buildMonthlyLog", () => {
  it("uses the previous closed calendar month", () => {
    const summary = buildMonthlyLog(media, activities, now);

    expect(monthlyLogLabel(summary.startsAt)).toBe("September 2026");
    expect(summary.entries.map((entry) => entry.media.title)).toEqual([
      "Arrival",
    ]);
    expect(summary.entries[0]).toMatchObject({ completed: true, repeats: 1 });
    expect(summary.titles).toBe(1);
    expect(summary.completed).toBe(1);
    expect(summary.repeats).toBe(1);
  });

  it("excludes invalid, current-month, and older events", () => {
    const summary = buildMonthlyLog(media, [
      ...activities,
      {
        id: 4,
        mediaId: 1,
        action: "updated",
        changes: { fromRepeatCount: 1, toRepeatCount: 2 },
        occurredAt: "invalid",
      },
      {
        id: 5,
        mediaId: 1,
        action: "updated",
        changes: { fromStatus: "in_progress", toStatus: "completed" },
        occurredAt: "2026-08-31T12:00:00Z",
      },
    ], now);

    expect(summary.entries).toHaveLength(1);
    expect(summary.repeats).toBe(1);
  });

  it("keeps the latest thirty entries while counting the whole month", () => {
    const manyMedia = Array.from({ length: 35 }, (_, index) => ({
      ...media[0],
      id: index + 1,
      title: `Title ${index + 1}`,
    }));
    const manyActivities: MonthlyLogActivity[] = manyMedia.map((
      item,
      index,
    ) => ({
      id: index + 1,
      mediaId: item.id,
      action: "updated",
      changes: { fromStatus: "in_progress", toStatus: "completed" },
      occurredAt: `2026-09-${
        String(Math.floor(index / 12) + 1).padStart(
          2,
          "0",
        )
      }T${String(12 + (index % 12)).padStart(2, "0")}:00:00Z`,
    }));

    const summary = buildMonthlyLog(manyMedia, manyActivities, now);
    expect(summary.entries).toHaveLength(30);
    expect(summary.titles).toBe(35);
    expect(summary.entries[0].media.title).toBe("Title 35");
  });

  it("limits the log and its totals to the selected media type", () => {
    const summary = buildMonthlyLog(media, activities, now, "movie");

    expect(summary.mediaType).toBe("movie");
    expect(summary.entries.map((entry) => entry.media.title)).toEqual([
      "Arrival",
    ]);
    expect(summary.titles).toBe(1);
    expect(summary.completed).toBe(1);
    expect(summary.repeats).toBe(1);
  });
});
