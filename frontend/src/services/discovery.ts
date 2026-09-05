import type {
  DiscoveryResponse,
  GlobalDiscoveryResponse,
} from "../types/discovery.ts";
import type { MediaType } from "../types/media.ts";
import { request } from "./http.ts";

export function searchGlobal(query: string, signal?: AbortSignal) {
  return request<GlobalDiscoveryResponse>(
    `/api/discovery/global?q=${encodeURIComponent(query)}`,
    { signal },
  );
}

export function searchCatalog(
  type: MediaType,
  query: string,
  page: number,
  signal?: AbortSignal,
) {
  const params = new URLSearchParams({ type, q: query, page: String(page) });
  return request<DiscoveryResponse>(`/api/discovery/search?${params}`, {
    signal,
  });
}
