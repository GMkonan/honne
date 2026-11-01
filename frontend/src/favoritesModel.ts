import type { TrackingMediaType } from "./mediaTracking.ts";

export interface FavoriteCandidate {
  id: number;
  title: string;
  coverUrl: string;
  type: string;
}

export const favoriteTypes: { value: TrackingMediaType; label: string }[] = [
  { value: "anime", label: "Anime" },
  { value: "series", label: "Series" },
  { value: "movie", label: "Movies" },
  { value: "book", label: "Books" },
  { value: "manga", label: "Manga" },
  { value: "light_novel", label: "Light novels" },
  { value: "game", label: "Games" },
];

export const favoritesPerType = 9;
