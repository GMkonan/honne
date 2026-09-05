import {
  BookOpen,
  Clapperboard,
  Film,
  Library,
  Sparkles,
  Tv,
} from "lucide-react";
import type { MediaInput, MediaStatus } from "../types/media.ts";

export const typeOptions = [
  { value: "anime", label: "Anime", jpLabel: "アニメ", icon: Sparkles },
  { value: "series", label: "Series", jpLabel: "ドラマ", icon: Tv },
  { value: "movie", label: "Movies", jpLabel: "映画", icon: Film },
  { value: "book", label: "Books", jpLabel: "本", icon: BookOpen },
  { value: "manga", label: "Manga", jpLabel: "漫画", icon: Library },
  {
    value: "light_novel",
    label: "Light novels",
    jpLabel: "ライトノベル",
    icon: Clapperboard,
  },
] as const;

export const statusOptions: { value: MediaStatus; label: string }[] = [
  { value: "planned", label: "Plan to read/watch" },
  { value: "in_progress", label: "In progress" },
  { value: "completed", label: "Completed" },
  { value: "paused", label: "Paused" },
  { value: "dropped", label: "Dropped" },
];

export const emptyForm: MediaInput = {
  title: "",
  type: "anime",
  status: "planned",
  progress: 0,
  total: 0,
  rating: 0,
  notes: "",
  coverUrl: "",
  provider: "",
  providerId: "",
  providerUrl: "",
  originalTitle: "",
  description: "",
  releaseYear: 0,
};
