import type { ActivityEvent } from "../types/activity.ts";
import { statusLabel } from "./media.ts";

export function activityDescription(activity: ActivityEvent): string {
  if (activity.action === "added") {
    return `Added to ${
      statusLabel(activity.changes.toStatus, activity.mediaType)
    }`;
  }
  if (activity.action === "imported") {
    return `Imported as ${
      statusLabel(activity.changes.toStatus, activity.mediaType)
    }`;
  }
  if (activity.action === "deleted") return "Removed from the library";

  const details: string[] = [];
  if (activity.changes.toStatus) {
    details.push(
      `${statusLabel(activity.changes.fromStatus, activity.mediaType)} → ${
        statusLabel(activity.changes.toStatus, activity.mediaType)
      }`,
    );
  }
  if (activity.changes.toProgress !== undefined) {
    details.push(
      `Progress ${
        activity.changes.fromProgress ?? 0
      } → ${activity.changes.toProgress}`,
    );
  }
  if (activity.changes.toRating !== undefined) {
    details.push(
      activity.changes.toRating === 0
        ? "Rating removed"
        : `Rating ${
          activity.changes.fromRating ?? 0
        } → ${activity.changes.toRating}`,
    );
  }
  return details.join(" · ") || "Updated details";
}

export function relativeTime(value: string): string {
  const elapsed = Date.now() - Date.parse(value);
  if (!Number.isFinite(elapsed) || elapsed < 0) return "just now";
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric" })
    .format(new Date(value));
}
