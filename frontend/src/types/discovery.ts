import type { MediaType } from "./media.ts";

export interface DiscoveryResult {
  provider: string;
  providerId: string;
  providerUrl: string;
  type: MediaType;
  title: string;
  originalTitle?: string;
  description?: string;
  coverUrl?: string;
  releaseYear?: number;
  total?: number;
  subtitle?: string;
  communityRating?: number;
}

export interface DiscoveryResponse {
  results: DiscoveryResult[];
  page: number;
  hasMore: boolean;
}

export interface GlobalDiscoveryResponse {
  results: DiscoveryResult[];
  unavailableTypes: MediaType[];
}
