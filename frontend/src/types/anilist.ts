import type { Media, MediaInput, MediaStatus, MediaType } from "./media.ts";

export interface AniListIntegrationStatus {
  configured: boolean;
  connected: boolean;
  username?: string;
  avatar?: string;
  expiresAt?: string;
  deleteOnLocalDelete: boolean;
  pending: number;
  errors: number;
}

export interface AniListImportEntry extends MediaInput {
  alreadyExists: boolean;
}

export interface AniListImportPreview {
  username: string;
  avatar?: string;
  entries: AniListImportEntry[];
}

export interface AniListImportResult {
  imported: number;
  skipped: number;
  items: Media[];
}

export interface AniListImportInput {
  username: string;
  types: MediaType[];
  statuses: MediaStatus[];
}

export interface AniListRetryResult {
  queued: number;
}
