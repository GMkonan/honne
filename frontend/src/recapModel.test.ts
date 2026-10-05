import { describe, expect, it } from "vitest";
import {
  buildRecapSummary,
  type RecapActivity,
  type RecapMedia,
} from "./recapModel.ts";

const now = new Date("2026-10-05T12:00:00Z");
const media: RecapMedia[] = [
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
  {
    id: 3,
    title: "Old title",
    type: "anime",
    status: "completed",
    rating: 8,
    repeatCount: 0,
    coverUrl: "",
    createdAt: "2025-01-01T00:00:00Z",
  },
];

const activities: RecapActivity[] = [
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
    occurredAt: "2026-10-04T12:00:00Z",
  },
  {
    id: 3,
    mediaId: 2,
    action: "added",
    changes: { toStatus: "completed" },
    occurredAt: "2026-10-03T12:00:00Z",
  },
  {
    id: 4,
    mediaId: 3,
    action: "updated",
    changes: { fromStatus: "in_progress", toStatus: "completed" },
    occurredAt: "2025-01-02T00:00:00Z",
  },
];

describe("buildRecapSummary", () => {
  it("selects and deduplicates completions and repeat increases", () => {
    const summary = buildRecapSummary(
      media,
      activities,
      "month",
      "finished",
      "recent",
      now,
    );

    expect(summary.entries.map((entry) => entry.media.title)).toEqual([
      "Arrival",
      "Dune",
    ]);
    expect(summary.entries[0]).toMatchObject({ completed: true, repeats: 1 });
    expect(summary.completed).toBe(2);
    expect(summary.repeats).toBe(1);
    expect(summary.added).toBe(2);
  });

  it("keeps added titles semantically separate and sorts by rating", () => {
    const summary = buildRecapSummary(
      media,
      activities,
      "month",
      "added",
      "rating",
      now,
    );

    expect(summary.entries.map((entry) => entry.media.title)).toEqual([
      "Dune",
      "Arrival",
    ]);
    expect(summary.completed).toBe(2);
    expect(summary.repeats).toBe(1);
    expect(summary.added).toBe(2);
  });

  it("excludes invalid, future, and out-of-period events", () => {
    const noisy: RecapActivity[] = [
      ...activities,
      {
        id: 5,
        mediaId: 1,
        action: "updated",
        changes: { fromRepeatCount: 1, toRepeatCount: 3 },
        occurredAt: "invalid",
      },
      {
        id: 6,
        mediaId: 1,
        action: "updated",
        changes: { fromRepeatCount: 1, toRepeatCount: 2 },
        occurredAt: "2026-10-06T12:00:00Z",
      },
    ];

    const summary = buildRecapSummary(
      media,
      noisy,
      "week",
      "finished",
      "recent",
      now,
    );
    expect(summary.entries.map((entry) => entry.media.title)).toEqual([
      "Arrival",
      "Dune",
    ]);
    expect(summary.repeats).toBe(1);
  });
});
