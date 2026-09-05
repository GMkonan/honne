import { describe, expect, it, vi } from "vitest";
import { addedActivity } from "../test/fixtures.ts";
import { activityDescription, relativeTime } from "./activity.ts";

describe("activity utilities", () => {
  it("formats activity transitions and rating removal", () => {
    expect(activityDescription(addedActivity)).toBe("Added to In progress");
    expect(activityDescription({
      ...addedActivity,
      action: "updated",
      changes: {
        fromStatus: "planned",
        toStatus: "in_progress",
        fromProgress: 0,
        toProgress: 2,
        fromRating: 7,
        toRating: 0,
      },
    })).toBe(
      "Plan to watch → In progress · Progress 0 → 2 · Rating removed",
    );
  });

  it("formats relative timestamps without exposing invalid dates", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-02T01:00:00Z"));
    expect(relativeTime("2026-01-02T00:00:00Z")).toBe("1h ago");
    expect(relativeTime("invalid")).toBe("just now");
    expect(relativeTime("2026-01-03T00:00:00Z")).toBe("just now");
  });
});
