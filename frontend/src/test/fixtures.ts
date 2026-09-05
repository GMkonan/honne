import type { ActivityEvent } from "../types/activity.ts";
import type { AniListIntegrationStatus } from "../types/anilist.ts";
import type { DiscoveryResult } from "../types/discovery.ts";
import type { Media } from "../types/media.ts";

export const cowboyBebop: Media = {
  id: 1,
  title: "Cowboy Bebop",
  type: "anime",
  status: "in_progress",
  progress: 8,
  total: 26,
  rating: 9,
  notes: "Synthetic fixture",
  coverUrl: "",
  provider: "anilist",
  providerId: "1",
  providerUrl: "https://anilist.co/anime/1",
  originalTitle: "カウボーイビバップ",
  description: "Synthetic description",
  releaseYear: 1998,
  providerListEntryId: 55,
  syncStatus: "synced",
  syncError: "",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-02T00:00:00Z",
};

export const connectedAniList: AniListIntegrationStatus = {
  configured: true,
  connected: true,
  username: "synthetic-user",
  deleteOnLocalDelete: true,
  pending: 0,
  errors: 0,
};

export const addedActivity: ActivityEvent = {
  id: 1,
  mediaId: 1,
  title: "Cowboy Bebop",
  mediaType: "anime",
  action: "added",
  changes: { toStatus: "in_progress" },
  occurredAt: "2026-01-02T00:00:00Z",
};

export const samuraiChamploo: DiscoveryResult = {
  provider: "anilist",
  providerId: "205",
  providerUrl: "https://anilist.co/anime/205",
  type: "anime",
  title: "Samurai Champloo",
  originalTitle: "サムライチャンプルー",
  description: "Synthetic catalog result",
  releaseYear: 2004,
  total: 26,
  subtitle: "TV · 26 episodes",
  communityRating: 8.5,
};
