import type { Media, MediaInput } from "../types/media.ts";
import { request } from "./http.ts";

export function listMedia(signal?: AbortSignal) {
  return request<Media[]>("/api/media", { signal });
}

export function createMedia(input: MediaInput, signal?: AbortSignal) {
  return request<Media>("/api/media", {
    method: "POST",
    body: JSON.stringify(input),
    signal,
  });
}

export function updateMedia(
  id: number,
  input: MediaInput,
  signal?: AbortSignal,
) {
  return request<Media>(`/api/media/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input),
    signal,
  });
}

export function deleteMedia(id: number, signal?: AbortSignal) {
  return request<null>(`/api/media/${id}`, { method: "DELETE", signal });
}
