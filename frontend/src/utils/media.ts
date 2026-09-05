import { statusOptions } from "../constants/media.tsx";
import type {
  Media,
  MediaInput,
  MediaStatus,
  MediaType,
} from "../types/media.ts";

export function mediaToInput(item: Media): MediaInput {
  return {
    title: item.title,
    type: item.type,
    status: item.status,
    progress: item.progress,
    total: item.total,
    rating: item.rating,
    notes: item.notes,
    coverUrl: item.coverUrl,
    provider: item.provider,
    providerId: item.providerId,
    providerUrl: item.providerUrl,
    originalTitle: item.originalTitle,
    description: item.description,
    releaseYear: item.releaseYear,
  };
}

export function previewCover(items: Media[], type?: MediaType): string {
  return items.find((item) =>
    (!type || item.type === type) && item.coverUrl.trim()
  )?.coverUrl.replaceAll('"', "") || "";
}

export function plannedLabel(type: MediaType | "all"): string {
  if (["book", "manga", "light_novel"].includes(type)) return "Plan to read";
  if (["anime", "series", "movie"].includes(type)) return "Plan to watch";
  return "Plan to read/watch";
}

export function statusLabel(
  status?: MediaStatus,
  type: MediaType | "all" = "all",
): string {
  if (status === "planned") return plannedLabel(type);
  return statusOptions.find((option) => option.value === status)?.label ||
    status?.replaceAll("_", " ") || "Unknown";
}
