import type {
  AniListImportInput,
  AniListImportPreview,
  AniListImportResult,
  AniListIntegrationStatus,
  AniListRetryResult,
} from "../types/anilist.ts";
import { request } from "./http.ts";

export function getAniListStatus(signal?: AbortSignal) {
  return request<AniListIntegrationStatus>("/api/integrations/anilist", {
    signal,
  });
}

export function disconnectAniList(
  discardPending: boolean,
  signal?: AbortSignal,
) {
  const suffix = discardPending ? "?discardPending=true" : "";
  return request<null>(`/api/integrations/anilist${suffix}`, {
    method: "DELETE",
    signal,
  });
}

export function retryAniList(signal?: AbortSignal) {
  return request<AniListRetryResult>("/api/integrations/anilist/retry", {
    method: "POST",
    signal,
  });
}

export function previewAniListImport(
  username: string,
  signal?: AbortSignal,
) {
  return request<AniListImportPreview>(
    `/api/import/anilist?username=${encodeURIComponent(username)}`,
    { signal },
  );
}

export function importAniListLibrary(
  input: AniListImportInput,
  signal?: AbortSignal,
) {
  return request<AniListImportResult>("/api/import/anilist", {
    method: "POST",
    body: JSON.stringify(input),
    signal,
  });
}
