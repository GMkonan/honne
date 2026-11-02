import {
  formatPlaytime,
  mediaStatusLabel,
  mediaTracking,
  plannedRepeatLabel,
  type TrackingMediaStatus,
  type TrackingMediaType,
} from "./mediaTracking.ts";

export interface ActivityChanges {
  fromStatus?: TrackingMediaStatus;
  toStatus?: TrackingMediaStatus;
  fromProgress?: number;
  toProgress?: number;
  fromRating?: number;
  toRating?: number;
  fromRepeatCount?: number;
  toRepeatCount?: number;
  fromPlannedRepeat?: boolean;
  toPlannedRepeat?: boolean;
  fromPlaytimeMinutes?: number;
  toPlaytimeMinutes?: number;
}

export interface ActivityEvent {
  id: number;
  mediaId?: number;
  title: string;
  mediaType: TrackingMediaType;
  action: "added" | "updated" | "deleted" | "imported";
  changes: ActivityChanges;
  occurredAt: string;
}

export function activityDescription(activity: ActivityEvent): string {
  if (activity.action === "added") {
    return `Added as ${
      mediaStatusLabel(activity.changes.toStatus, activity.mediaType)
    }`;
  }
  if (activity.action === "imported") {
    return `Imported as ${
      mediaStatusLabel(activity.changes.toStatus, activity.mediaType)
    }`;
  }
  if (activity.action === "deleted") return "Removed from the library";

  const details: string[] = [];
  if (activity.changes.toStatus) {
    details.push(
      `${mediaStatusLabel(activity.changes.fromStatus, activity.mediaType)} → ${
        mediaStatusLabel(activity.changes.toStatus, activity.mediaType)
      }`,
    );
  }
  if (activity.changes.toProgress !== undefined) {
    const tracking = mediaTracking(activity.mediaType);
    details.push(
      `${tracking.tracksProgress ? tracking.unitLabel : "Progress"} ${
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
  if (activity.changes.toRepeatCount !== undefined) {
    details.push(
      `${mediaTracking(activity.mediaType).repeatLabel} ${
        activity.changes.fromRepeatCount ?? 0
      } → ${activity.changes.toRepeatCount}`,
    );
  }
  if (activity.changes.toPlannedRepeat !== undefined) {
    details.push(
      activity.changes.toPlannedRepeat
        ? plannedRepeatLabel(activity.mediaType)
        : "Repeat plan cleared",
    );
  }
  if (activity.changes.toPlaytimeMinutes !== undefined) {
    details.push(
      `Playtime ${
        formatPlaytime(activity.changes.fromPlaytimeMinutes ?? 0)
      } → ${formatPlaytime(activity.changes.toPlaytimeMinutes)}`,
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
