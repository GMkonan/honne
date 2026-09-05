export type MediaType =
  | "anime"
  | "series"
  | "movie"
  | "book"
  | "manga"
  | "light_novel";

export type MediaStatus =
  | "planned"
  | "in_progress"
  | "completed"
  | "paused"
  | "dropped";

export interface MediaInput {
  title: string;
  type: MediaType;
  status: MediaStatus;
  progress: number;
  total: number;
  rating: number;
  notes: string;
  coverUrl: string;
  provider: string;
  providerId: string;
  providerUrl: string;
  originalTitle: string;
  description: string;
  releaseYear: number;
}

export interface Media extends MediaInput {
  id: number;
  providerListEntryId?: number;
  syncStatus?: "local_only" | "waiting_auth" | "pending" | "synced" | "error";
  syncError?: string;
  createdAt: string;
  updatedAt: string;
}

export type LibrarySort = "recent" | "added" | "title" | "rating";
