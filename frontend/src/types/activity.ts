import type { MediaStatus, MediaType } from "./media.ts";

export interface ActivityChanges {
  fromStatus?: MediaStatus;
  toStatus?: MediaStatus;
  fromProgress?: number;
  toProgress?: number;
  fromRating?: number;
  toRating?: number;
}

export interface ActivityEvent {
  id: number;
  mediaId?: number;
  title: string;
  mediaType: MediaType;
  action: "added" | "updated" | "deleted" | "imported";
  changes: ActivityChanges;
  occurredAt: string;
}
