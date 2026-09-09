const baseMedia = {
  progress: 0,
  total: 0,
  rating: 0,
  repeatCount: 0,
  notes: "",
  coverUrl: "",
  provider: "",
  providerId: "",
  providerUrl: "",
  originalTitle: "",
  description: "Synthetic fixture",
  releaseYear: 0,
  syncStatus: "local_only",
  syncError: "",
};

export const cowboyBebop = {
  ...baseMedia,
  id: 1,
  title: "Cowboy Bebop",
  type: "anime",
  status: "in_progress",
  progress: 8,
  total: 26,
  rating: 9,
  releaseYear: 1998,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-02T00:00:00Z",
};

export const dune = {
  ...baseMedia,
  id: 2,
  title: "Dune",
  type: "book",
  status: "planned",
  total: 412,
  rating: 8,
  releaseYear: 1965,
  createdAt: "2026-01-03T00:00:00Z",
  updatedAt: "2026-01-04T00:00:00Z",
};

export const spiritedAway = {
  ...baseMedia,
  id: 3,
  title: "Spirited Away",
  type: "movie",
  status: "completed",
  progress: 1,
  total: 1,
  rating: 10,
  releaseYear: 2001,
  createdAt: "2025-12-01T00:00:00Z",
  updatedAt: "2026-01-03T00:00:00Z",
};

export const mediaItems = [cowboyBebop, dune, spiritedAway];

export const disconnectedAniList = {
  configured: false,
  connected: false,
  deleteOnLocalDelete: true,
  pending: 0,
  errors: 0,
};
