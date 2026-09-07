import {
  type ChangeEvent,
  type FormEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  BookOpen,
  Check,
  CirclePlus,
  Clapperboard,
  Clock3,
  Cog,
  Film,
  Library,
  Link2,
  type LucideIcon,
  Menu,
  Pencil,
  RefreshCw,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Sparkles,
  Star,
  Trash2,
  Tv,
  X,
} from "lucide-react";
import { BackupSettingsCard } from "./components/BackupSettingsCard.tsx";
import {
  GlobalSearchBox,
  type SearchCatalogResult,
  type SearchMediaCredit,
} from "./components/GlobalSearchBox.tsx";
import { GlobalSearchPage } from "./components/GlobalSearchPage.tsx";
import {
  type ManagedMediaValues,
  ManageMediaModal,
} from "./components/ManageMediaModal.tsx";
import { MediaDetailPage } from "./components/MediaDetailPage.tsx";
import { LibraryHero, type PublicProfile } from "./components/LibraryHero.tsx";

type MediaType =
  | "anime"
  | "series"
  | "movie"
  | "book"
  | "manga"
  | "light_novel";
type MediaStatus =
  | "planned"
  | "in_progress"
  | "completed"
  | "paused"
  | "dropped";

interface MediaInput {
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
  format: string;
  genres: string[];
  credits: SearchMediaCredit[];
  releaseStatus: string;
  startDate: string;
  endDate: string;
  durationMinutes: number;
  catalogTotal: number;
  communityRating: number;
}

interface Media extends MediaInput {
  id: number;
  providerListEntryId?: number;
  syncStatus?: "local_only" | "waiting_auth" | "pending" | "synced" | "error";
  syncError?: string;
  createdAt: string;
  updatedAt: string;
}

interface ActivityChanges {
  fromStatus?: MediaStatus;
  toStatus?: MediaStatus;
  fromProgress?: number;
  toProgress?: number;
  fromRating?: number;
  toRating?: number;
}

interface ActivityEvent {
  id: number;
  mediaId?: number;
  title: string;
  mediaType: MediaType;
  action: "added" | "updated" | "deleted" | "imported";
  changes: ActivityChanges;
  occurredAt: string;
}

type LibrarySort = "recent" | "added" | "title" | "rating";
type AppView = "library" | "activity" | "settings" | "search" | "detail";
type DetailSelection =
  | { kind: "local"; mediaId: number }
  | { kind: "external"; result: DiscoveryResult };

interface GlobalDiscoveryResponse {
  results: DiscoveryResult[];
  unavailableTypes: MediaType[];
}

interface AniListIntegrationStatus {
  configured: boolean;
  connected: boolean;
  username?: string;
  avatar?: string;
  expiresAt?: string;
  deleteOnLocalDelete: boolean;
  pending: number;
  errors: number;
}

type DiscoveryResult = SearchCatalogResult;

interface DiscoveryResponse {
  results: DiscoveryResult[];
  page: number;
  hasMore: boolean;
}

interface AniListImportEntry extends MediaInput {
  alreadyExists: boolean;
}

interface AniListImportPreview {
  username: string;
  avatar?: string;
  entries: AniListImportEntry[];
}

interface AniListImportResult {
  imported: number;
  skipped: number;
  items: Media[];
}

class RequestError extends Error {
  existingId?: number;
}

interface TypeOption {
  value: MediaType;
  label: string;
  jpLabel: string;
  icon: LucideIcon;
}

const typeOptions: TypeOption[] = [
  {
    value: "anime",
    label: "Anime",
    jpLabel: "アニメ",
    icon: Sparkles,
  },
  {
    value: "series",
    label: "Series",
    jpLabel: "ドラマ",
    icon: Tv,
  },
  {
    value: "movie",
    label: "Movies",
    jpLabel: "映画",
    icon: Film,
  },
  {
    value: "book",
    label: "Books",
    jpLabel: "本",
    icon: BookOpen,
  },
  {
    value: "manga",
    label: "Manga",
    jpLabel: "漫画",
    icon: Library,
  },
  {
    value: "light_novel",
    label: "Light novels",
    jpLabel: "ライトノベル",
    icon: Clapperboard,
  },
];

const statusOptions: { value: MediaStatus; label: string }[] = [
  { value: "planned", label: "Plan to read/watch" },
  { value: "in_progress", label: "In progress" },
  { value: "completed", label: "Completed" },
  { value: "paused", label: "Paused" },
  { value: "dropped", label: "Dropped" },
];

const emptyForm: MediaInput = {
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
  format: "",
  genres: [],
  credits: [],
  releaseStatus: "",
  startDate: "",
  endDate: "",
  durationMinutes: 0,
  catalogTotal: 0,
  communityRating: 0,
};

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as {
      error?: string;
      existingId?: number;
    };
    const error = new RequestError(
      body.error || "Something went wrong. Please try again.",
    );
    error.existingId = body.existingId;
    throw error;
  }
  return (response.status === 204 ? null : await response.json()) as T;
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Something went wrong. Please try again.";
}

function findExistingLibraryItem(
  result: DiscoveryResult,
  items: Media[],
): Media | undefined {
  if (result.provider && result.providerId) {
    const providerMatch = items.find((item) =>
      item.provider === result.provider && item.providerId === result.providerId
    );
    if (providerMatch) return providerMatch;
  }

  const resultTitles = [result.title, result.originalTitle]
    .filter((title): title is string => Boolean(title))
    .map((title) => title.trim().toLocaleLowerCase("en"));
  return items.find((item) =>
    item.type === result.type &&
    [item.title, item.originalTitle].some((title) =>
      resultTitles.includes((title || "").trim().toLocaleLowerCase("en"))
    )
  );
}

function isAlreadyInLibrary(result: DiscoveryResult, items: Media[]) {
  return Boolean(findExistingLibraryItem(result, items));
}

function hasExpandedMetadata(item: Media): boolean {
  return Boolean(
    item.format || item.releaseStatus || item.startDate || item.endDate ||
      item.durationMinutes || item.catalogTotal || item.communityRating ||
      item.genres?.length || item.credits?.length,
  );
}

function mediaToInput(item: Media): MediaInput {
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
    format: item.format || "",
    genres: Array.isArray(item.genres) ? item.genres : [],
    credits: Array.isArray(item.credits) ? item.credits : [],
    releaseStatus: item.releaseStatus || "",
    startDate: item.startDate || "",
    endDate: item.endDate || "",
    durationMinutes: item.durationMinutes || 0,
    catalogTotal: item.catalogTotal || 0,
    communityRating: item.communityRating || 0,
  };
}

function previewCover(items: Media[], type?: MediaType): string {
  return items.find((item) =>
    (!type || item.type === type) && item.coverUrl.trim()
  )?.coverUrl.replaceAll('"', "") || "";
}

function plannedLabel(type: MediaType | "all"): string {
  if (["book", "manga", "light_novel"].includes(type)) return "Plan to read";
  if (["anime", "series", "movie"].includes(type)) return "Plan to watch";
  return "Plan to read/watch";
}

function statusLabel(
  status?: MediaStatus,
  type: MediaType | "all" = "all",
): string {
  if (status === "planned") return plannedLabel(type);
  return statusOptions.find((option) => option.value === status)?.label ||
    status?.replaceAll("_", " ") || "Unknown";
}

function activityDescription(activity: ActivityEvent): string {
  if (activity.action === "added") {
    return `Added to ${
      statusLabel(activity.changes.toStatus, activity.mediaType)
    }`;
  }
  if (activity.action === "imported") {
    return `Imported as ${
      statusLabel(activity.changes.toStatus, activity.mediaType)
    }`;
  }
  if (activity.action === "deleted") return "Removed from the library";

  const details: string[] = [];
  if (activity.changes.toStatus) {
    details.push(
      `${statusLabel(activity.changes.fromStatus, activity.mediaType)} → ${
        statusLabel(activity.changes.toStatus, activity.mediaType)
      }`,
    );
  }
  if (activity.changes.toProgress !== undefined) {
    details.push(
      `Progress ${
        activity.changes.fromProgress ?? 0
      } → ${activity.changes.toProgress}`,
    );
  }
  if (activity.changes.toRating !== undefined) {
    details.push(
      activity.changes.toRating === 0
        ? "Rating removed"
        : `Rating ${
          activity.changes.fromRating ?? 0
        } → ${activity.changes.toRating}`,
    );
  }
  return details.join(" · ") || "Updated details";
}

function relativeTime(value: string): string {
  const elapsed = Date.now() - Date.parse(value);
  if (!Number.isFinite(elapsed) || elapsed < 0) return "just now";
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric" })
    .format(new Date(value));
}

function searchFromHash(): string {
  const match = globalThis.location.hash.match(/^#search\/(.+)$/);
  if (!match) return "";
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return "";
  }
}

function routeFromHash(): AppView {
  const hash = globalThis.location.hash;
  if (hash === "#activity") return "activity";
  if (hash === "#settings") return "settings";
  if (hash.startsWith("#search")) return "search";
  if (hash.startsWith("#media/") || hash.startsWith("#catalog/")) {
    return "detail";
  }
  return "library";
}

function safeHTTPURL(value?: string): string {
  if (!value) return "";
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? parsed.href
      : "";
  } catch {
    return "";
  }
}

function safeStoredText(
  value: unknown,
  maxLength = 10_000,
): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed && Array.from(trimmed).length <= maxLength
    ? trimmed
    : undefined;
}

function safeStoredNumber(
  value: unknown,
  minimum: number,
  maximum: number,
): number | undefined {
  return typeof value === "number" && Number.isFinite(value) &&
      value >= minimum && value <= maximum
    ? value
    : undefined;
}

function safeStoredDate(value: unknown): string | undefined {
  const date = safeStoredText(value, 10);
  return date && /^\d{4}(?:-\d{2}(?:-\d{2})?)?$/u.test(date) ? date : undefined;
}

function sanitizeStoredResult(result: DiscoveryResult): DiscoveryResult {
  const genres = Array.isArray(result.genres)
    ? result.genres.map((genre) => safeStoredText(genre, 100)).filter(
      (genre): genre is string => Boolean(genre),
    ).slice(0, 12)
    : [];
  const credits = Array.isArray(result.credits)
    ? result.credits.filter((credit) =>
      Boolean(
        credit && safeStoredText(credit.name, 100) &&
          safeStoredText(credit.role, 100),
      )
    ).slice(0, 12).map((credit) => ({
      name: credit.name.trim(),
      role: credit.role.trim(),
    }))
    : [];
  const releaseStatus = safeStoredText(result.releaseStatus, 20);
  const allowedReleaseStatuses = [
    "announced",
    "upcoming",
    "releasing",
    "finished",
    "cancelled",
    "hiatus",
  ];
  return {
    provider: result.provider,
    providerId: result.providerId,
    providerUrl: safeStoredText(result.providerUrl) || "",
    type: result.type,
    title: safeStoredText(result.title, 200) || "Untitled",
    originalTitle: safeStoredText(result.originalTitle),
    description: safeStoredText(result.description),
    coverUrl: safeStoredText(result.coverUrl),
    releaseYear: safeStoredNumber(result.releaseYear, 0, 9999),
    total: safeStoredNumber(result.total, 0, Number.MAX_SAFE_INTEGER),
    subtitle: safeStoredText(result.subtitle, 100),
    format: safeStoredText(result.format, 50),
    genres,
    credits,
    releaseStatus:
      releaseStatus && allowedReleaseStatuses.includes(releaseStatus)
        ? releaseStatus
        : undefined,
    startDate: safeStoredDate(result.startDate),
    endDate: safeStoredDate(result.endDate),
    durationMinutes: safeStoredNumber(result.durationMinutes, 0, 10_080),
    catalogTotal: safeStoredNumber(
      result.catalogTotal,
      0,
      Number.MAX_SAFE_INTEGER,
    ),
    communityRating: safeStoredNumber(result.communityRating, 0, 10),
  };
}

function storedExternalDetail(): DetailSelection | null {
  const match = globalThis.location.hash.match(
    /^#catalog\/([^/]+)\/([^/]+)\/([^/]+)$/,
  );
  if (!match) return null;
  try {
    const provider = decodeURIComponent(match[1]);
    const type = decodeURIComponent(match[2]);
    const providerId = decodeURIComponent(match[3]);
    const storageKey = `honne:catalog:${provider}:${type}:${providerId}`;
    const result = JSON.parse(
      globalThis.sessionStorage.getItem(storageKey) || "null",
    ) as DiscoveryResult | null;
    if (
      result && result.provider === provider && result.type === type &&
      result.providerId === providerId && safeStoredText(result.title, 200) &&
      typeOptions.some((option) => option.value === result.type)
    ) {
      return { kind: "external", result: sanitizeStoredResult(result) };
    }
  } catch {
    // A missing or malformed session entry is handled by the not-found page.
  }
  return null;
}

function App() {
  const [view, setView] = useState<AppView>(routeFromHash);
  const [detail, setDetail] = useState<DetailSelection | null>(() => {
    const match = globalThis.location.hash.match(/^#media\/(\d+)$/);
    return match
      ? { kind: "local", mediaId: Number(match[1]) }
      : storedExternalDetail();
  });
  const [detailOrigin, setDetailOrigin] = useState<
    "library" | "activity" | "search"
  >("library");
  const [globalQuery, setGlobalQuery] = useState(searchFromHash);
  const [submittedQuery, setSubmittedQuery] = useState(searchFromHash);
  const [globalResults, setGlobalResults] = useState<DiscoveryResult[]>([]);
  const [unavailableTypes, setUnavailableTypes] = useState<MediaType[]>([]);
  const [globalLoading, setGlobalLoading] = useState(false);
  const [globalError, setGlobalError] = useState("");
  const [searchGeneration, setSearchGeneration] = useState(0);
  const [suggestionQuery, setSuggestionQuery] = useState("");
  const [suggestionResults, setSuggestionResults] = useState<
    DiscoveryResult[]
  >([]);
  const [suggestionResultQuery, setSuggestionResultQuery] = useState("");
  const [suggestionUnavailableTypes, setSuggestionUnavailableTypes] = useState<
    MediaType[]
  >([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [suggestionsError, setSuggestionsError] = useState("");
  const [items, setItems] = useState<Media[]>([]);
  const [activities, setActivities] = useState<ActivityEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [activityLoading, setActivityLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [activeType, setActiveType] = useState<MediaType | "all">("all");
  const [activeStatus, setActiveStatus] = useState<MediaStatus | "all">("all");
  const [sortBy, setSortBy] = useState<LibrarySort>("recent");
  const [modalItem, setModalItem] = useState<Media | null | undefined>(
    undefined,
  );
  const [managedItem, setManagedItem] = useState<Media | undefined>(undefined);
  const [metadataRefreshingId, setMetadataRefreshingId] = useState<
    number | undefined
  >(undefined);
  const [metadataRefreshError, setMetadataRefreshError] = useState<
    {
      id: number;
      message: string;
    } | null
  >(null);
  const metadataRefreshAttempted = useRef(new Set<number>());
  const [draftItem, setDraftItem] = useState<MediaInput | undefined>(undefined);
  const [discoveryType, setDiscoveryType] = useState<
    MediaType | null | undefined
  >(undefined);
  const [menuOpen, setMenuOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [integrationOpen, setIntegrationOpen] = useState(false);
  const [anilistStatus, setAniListStatus] = useState<
    AniListIntegrationStatus | null
  >(null);
  const [profile, setProfile] = useState<PublicProfile>({
    name: "My Library",
    avatarUrl: "",
  });
  const [profileLoading, setProfileLoading] = useState(true);

  useEffect(() => {
    let active = true;
    void request<PublicProfile>("/api/profile").then((publicProfile) => {
      if (active) setProfile(publicProfile);
    }).catch((caught: unknown) => {
      if (active) setError(`Profile: ${errorMessage(caught)}`);
    }).finally(() => {
      if (active) setProfileLoading(false);
    });

    async function refresh(initial: boolean) {
      try {
        const [library, integration, recentActivity] = await Promise.all([
          request<Media[]>("/api/media"),
          request<AniListIntegrationStatus>("/api/integrations/anilist"),
          request<ActivityEvent[]>("/api/activity?limit=100"),
        ]);
        if (active) {
          setItems(library);
          setAniListStatus(integration);
          setActivities(recentActivity);
        }
      } catch (caught: unknown) {
        if (active && initial) setError(errorMessage(caught));
      } finally {
        if (active && initial) {
          setLoading(false);
          setActivityLoading(false);
        }
      }
    }
    void refresh(true);
    const timer = setInterval(() => void refresh(false), 15_000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    function syncRoute() {
      const nextView = routeFromHash();
      if (nextView === "detail") {
        const match = globalThis.location.hash.match(/^#media\/(\d+)$/);
        if (match) setDetail({ kind: "local", mediaId: Number(match[1]) });
        else setDetail(storedExternalDetail());
      }
      if (nextView === "search") {
        const query = searchFromHash();
        if (query) {
          setSubmittedQuery(query);
          setGlobalQuery(query);
        }
      }
      setView(nextView);
      setMenuOpen(false);
      globalThis.scrollTo({ top: 0, behavior: "smooth" });
    }
    globalThis.addEventListener("hashchange", syncRoute);
    return () => globalThis.removeEventListener("hashchange", syncRoute);
  }, []);

  useEffect(() => {
    if (detail?.kind !== "local") {
      setMetadataRefreshError(null);
      return;
    }
    const item = items.find((entry) => entry.id === detail.mediaId);
    if (
      !item?.provider || hasExpandedMetadata(item) ||
      metadataRefreshAttempted.current.has(item.id)
    ) return;
    void refreshMediaMetadata(item);
  }, [detail, items]);

  useEffect(() => {
    const query = suggestionQuery.trim();
    const queryLength = Array.from(query).length;
    setSuggestionResults([]);
    setSuggestionUnavailableTypes([]);
    setSuggestionsError("");
    setSuggestionsLoading(queryLength >= 3);
    if (queryLength < 3) return;

    const controller = new AbortController();
    let active = true;
    const timer = setTimeout(() => {
      request<GlobalDiscoveryResponse>(
        `/api/discovery/global?q=${encodeURIComponent(query)}`,
        { signal: controller.signal },
      ).then((response) => {
        if (!active) return;
        setSuggestionResults(response.results);
        setSuggestionResultQuery(query);
        setSuggestionUnavailableTypes(response.unavailableTypes);
      }).catch((caught: unknown) => {
        if (
          !active ||
          (caught instanceof DOMException && caught.name === "AbortError")
        ) return;
        setSuggestionsError(errorMessage(caught));
      }).finally(() => {
        if (active) setSuggestionsLoading(false);
      });
    }, 350);

    return () => {
      active = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [suggestionQuery]);

  useEffect(() => {
    if (Array.from(submittedQuery.trim()).length < 2) return;
    const controller = new AbortController();
    let active = true;
    setGlobalLoading(true);
    setGlobalError("");
    setGlobalResults([]);
    setUnavailableTypes([]);
    request<GlobalDiscoveryResponse>(
      `/api/discovery/global?q=${encodeURIComponent(submittedQuery.trim())}`,
      { signal: controller.signal },
    ).then((response) => {
      if (!active) return;
      setGlobalResults(response.results);
      setUnavailableTypes(response.unavailableTypes);
    }).catch((caught: unknown) => {
      if (
        !active ||
        (caught instanceof DOMException && caught.name === "AbortError")
      ) return;
      setGlobalError(errorMessage(caught));
    }).finally(() => {
      if (active) setGlobalLoading(false);
    });
    return () => {
      active = false;
      controller.abort();
    };
  }, [submittedQuery, searchGeneration]);

  function navigate(next: Exclude<AppView, "detail">) {
    const hash = next === "library" ? "#library" : `#${next}`;
    if (globalThis.location.hash === hash) {
      setView(next);
      globalThis.scrollTo({ top: 0, behavior: "smooth" });
    } else globalThis.location.hash = hash;
  }

  function rememberDetailOrigin() {
    if (view === "activity" || view === "search") setDetailOrigin(view);
    else if (view !== "detail") setDetailOrigin("library");
  }

  function openLocalDetail(mediaId: number) {
    rememberDetailOrigin();
    setDetail({ kind: "local", mediaId });
    globalThis.location.hash = `#media/${mediaId}`;
  }

  function openExternalDetail(result: DiscoveryResult) {
    rememberDetailOrigin();
    setDetail({ kind: "external", result });
    try {
      const storageKey =
        `honne:catalog:${result.provider}:${result.type}:${result.providerId}`;
      globalThis.sessionStorage.setItem(storageKey, JSON.stringify(result));
    } catch {
      // The current view still works when private browsing blocks storage.
    }
    setView("detail");
    globalThis.location.hash = `#catalog/${
      encodeURIComponent(result.provider)
    }/${encodeURIComponent(result.type)}/${
      encodeURIComponent(result.providerId)
    }`;
    globalThis.scrollTo({ top: 0, behavior: "smooth" });
  }

  function submitGlobalSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = globalQuery.trim();
    if (Array.from(query).length < 2) return;
    setSubmittedQuery(query);
    setSearchGeneration((current) => current + 1);
    setSuggestionQuery("");
    setMenuOpen(false);
    const hash = `#search/${encodeURIComponent(query)}`;
    if (globalThis.location.hash === hash) setView("search");
    else globalThis.location.hash = hash;
  }

  function leaveDetail() {
    if (detailOrigin === "search" && submittedQuery) {
      globalThis.location.hash = `#search/${
        encodeURIComponent(submittedQuery)
      }`;
      return;
    }
    navigate(detailOrigin);
  }

  async function refreshAniListStatus() {
    const status = await request<AniListIntegrationStatus>(
      "/api/integrations/anilist",
    );
    setAniListStatus(status);
  }

  async function refreshActivity() {
    const recent = await request<ActivityEvent[]>("/api/activity?limit=100");
    setActivities(recent);
  }

  const filtered = items.filter((item) => {
    const matchesSearch = item.title.toLocaleLowerCase("en").includes(
      search.toLocaleLowerCase("en"),
    );
    return matchesSearch &&
      (activeType === "all" || item.type === activeType) &&
      (activeStatus === "all" || item.status === activeStatus);
  }).sort((a, b) => {
    if (sortBy === "title") return a.title.localeCompare(b.title);
    if (sortBy === "rating") {
      return b.rating - a.rating || a.title.localeCompare(b.title);
    }
    if (sortBy === "added") {
      return Date.parse(b.createdAt) - Date.parse(a.createdAt);
    }
    return Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
  });

  const inProgress =
    items.filter((item) => item.status === "in_progress").length;
  const statusScope = activeType === "all"
    ? items
    : items.filter((item) => item.type === activeType);
  const catalogSearchResults = globalResults.filter((result) =>
    !isAlreadyInLibrary(result, items)
  );
  const catalogSuggestionResults = suggestionResultQuery === globalQuery.trim()
    ? suggestionResults.filter((result) => !isAlreadyInLibrary(result, items))
    : [];

  async function saveItem(values: MediaInput) {
    let saved: Media;
    try {
      saved = modalItem?.id
        ? await request<Media>(`/api/media/${modalItem.id}`, {
          method: "PATCH",
          body: JSON.stringify(values),
        })
        : await request<Media>("/api/media", {
          method: "POST",
          body: JSON.stringify(values),
        });
    } catch (caught: unknown) {
      if (caught instanceof RequestError && caught.existingId) {
        const existing = items.find((item) => item.id === caught.existingId);
        if (existing) {
          setDraftItem(undefined);
          setModalItem(undefined);
          setManagedItem(existing);
          return;
        }
      }
      throw caught;
    }
    setItems((current) =>
      modalItem?.id
        ? current.map((item) => item.id === saved.id ? saved : item)
        : [saved, ...current]
    );
    void refreshAniListStatus().catch(() => {});
    void refreshActivity().catch(() => {});
    if (!modalItem?.id && detail?.kind === "external") {
      setDetail({ kind: "local", mediaId: saved.id });
      globalThis.location.hash = `#media/${saved.id}`;
    }
    setModalItem(undefined);
    setDraftItem(undefined);
  }

  async function refreshMediaMetadata(item: Media) {
    metadataRefreshAttempted.current.add(item.id);
    setMetadataRefreshingId(item.id);
    setMetadataRefreshError(null);
    try {
      const refreshed = await request<Media>(
        `/api/media/${item.id}/refresh-metadata`,
        { method: "POST" },
      );
      setItems((current) =>
        current.map((entry) => entry.id === refreshed.id ? refreshed : entry)
      );
    } catch (caught: unknown) {
      setMetadataRefreshError({ id: item.id, message: errorMessage(caught) });
    } finally {
      setMetadataRefreshingId((current) =>
        current === item.id ? undefined : current
      );
    }
  }

  async function saveManagedItem(
    item: Media,
    values: ManagedMediaValues,
  ) {
    const saved = await request<Media>(`/api/media/${item.id}`, {
      method: "PATCH",
      body: JSON.stringify({ ...mediaToInput(item), ...values }),
    });
    setItems((current) =>
      current.map((entry) => entry.id === saved.id ? saved : entry)
    );
    void refreshAniListStatus().catch(() => {});
    void refreshActivity().catch(() => {});
    setManagedItem(undefined);
  }

  function reviewDiscovery(result: DiscoveryResult) {
    setDraftItem({
      ...emptyForm,
      title: result.title,
      type: result.type,
      total: result.total || 0,
      coverUrl: result.coverUrl || "",
      provider: result.provider,
      providerId: result.providerId,
      providerUrl: result.providerUrl,
      originalTitle: result.originalTitle || "",
      description: result.description || "",
      releaseYear: result.releaseYear || 0,
      format: result.format || result.subtitle || "",
      genres: Array.isArray(result.genres) ? result.genres : [],
      credits: Array.isArray(result.credits) ? result.credits : [],
      releaseStatus: result.releaseStatus || "",
      startDate: result.startDate || "",
      endDate: result.endDate || "",
      durationMinutes: result.durationMinutes || 0,
      catalogTotal: result.catalogTotal || result.total || 0,
      communityRating: result.communityRating || 0,
    });
    setDiscoveryType(undefined);
    setModalItem(null);
  }

  function openManualEntry() {
    setDiscoveryType(undefined);
    setDraftItem(undefined);
    setModalItem(null);
  }

  async function importAniList(
    username: string,
    types: MediaType[],
    statuses: MediaStatus[],
  ) {
    const result = await request<AniListImportResult>("/api/import/anilist", {
      method: "POST",
      body: JSON.stringify({ username, types, statuses }),
    });
    setItems((current) => [...result.items, ...current]);
    void refreshAniListStatus().catch(() => {});
    void refreshActivity().catch(() => {});
    setImportOpen(false);
    return result;
  }

  async function deleteItem(item: Media): Promise<boolean> {
    const hasRemoteSync = !!item.providerListEntryId ||
      ["waiting_auth", "pending", "synced", "error"].includes(
        item.syncStatus || "",
      );
    const removesFromAniList = item.provider === "anilist" && hasRemoteSync &&
      anilistStatus?.configured && anilistStatus.deleteOnLocalDelete;
    const message = removesFromAniList
      ? `Remove “${item.title}” from Honne and your AniList list?`
      : `Remove “${item.title}” from your collection?`;
    if (!globalThis.confirm(message)) return false;
    try {
      await request<null>(`/api/media/${item.id}`, { method: "DELETE" });
      setItems((current) => current.filter(({ id }) => id !== item.id));
      void refreshAniListStatus().catch(() => {});
      void refreshActivity().catch(() => {});
      return true;
    } catch (caught: unknown) {
      setError(errorMessage(caught));
      return false;
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar" id="top">
        <div className="topbar-inner">
          <a className="brand" href="#library" aria-label="Honne, library">
            <span className="brand-glyph">本音</span>
            <span>honne</span>
          </a>
          <nav className={menuOpen ? "main-nav open" : "main-nav"}>
            <a
              className={view === "library" ? "active" : ""}
              href="#library"
              aria-current={view === "library" ? "page" : undefined}
              onClick={() => setMenuOpen(false)}
            >
              Library
            </a>
            <a
              className={view === "activity" ? "active" : ""}
              href="#activity"
              aria-current={view === "activity" ? "page" : undefined}
              onClick={() => setMenuOpen(false)}
            >
              Activity
            </a>
            <a
              className={view === "settings" ? "active" : ""}
              href="#settings"
              aria-current={view === "settings" ? "page" : undefined}
              onClick={() => setMenuOpen(false)}
            >
              Settings
              {!!anilistStatus?.pending && (
                <span className="nav-count">{anilistStatus.pending}</span>
              )}
            </a>
            <GlobalSearchBox
              id="mobile-global-search"
              className="mobile-global-search"
              label="Catalog search"
              placeholder="Search catalogs"
              query={globalQuery}
              catalogResults={catalogSuggestionResults}
              unavailableCatalogs={suggestionResultQuery === globalQuery.trim()
                ? suggestionUnavailableTypes.length
                : 0}
              catalogLoading={suggestionsLoading}
              catalogError={suggestionsError}
              onQueryChange={setGlobalQuery}
              onActivate={setSuggestionQuery}
              onDeactivate={() => setSuggestionQuery("")}
              onSubmit={submitGlobalSearch}
              onOpenCatalog={(result) => {
                setMenuOpen(false);
                setSuggestionQuery("");
                openExternalDetail(result);
              }}
            />
          </nav>
          <GlobalSearchBox
            id="desktop-global-search"
            className="nav-search"
            label="Search catalogs"
            placeholder="Search catalogs"
            query={globalQuery}
            catalogResults={catalogSuggestionResults}
            unavailableCatalogs={suggestionResultQuery === globalQuery.trim()
              ? suggestionUnavailableTypes.length
              : 0}
            catalogLoading={suggestionsLoading}
            catalogError={suggestionsError}
            onQueryChange={setGlobalQuery}
            onActivate={setSuggestionQuery}
            onDeactivate={() => setSuggestionQuery("")}
            onSubmit={submitGlobalSearch}
            onOpenCatalog={(result) => {
              setSuggestionQuery("");
              openExternalDetail(result);
            }}
          />
          <button
            type="button"
            className="menu-button"
            onClick={() => setMenuOpen((open) => !open)}
            aria-label="Toggle menu"
          >
            {menuOpen ? <X /> : <Menu />}
          </button>
        </div>
      </header>

      {view === "library" && (
        <>
          <LibraryHero
            profile={profile}
            profileLoading={profileLoading}
            collectionLoading={loading}
            totalTitles={items.length}
            inProgress={inProgress}
          />

          <main className="page-container content" id="filters">
            <section className="filter-section" aria-label="Media type filters">
              <div className="filter-surface">
                <div className="filter-group format-filter">
                  <span className="filter-label">Media type</span>
                  <div className="format-options">
                    <button
                      type="button"
                      aria-pressed={activeType === "all"}
                      className={activeType === "all" ? "active" : ""}
                      onClick={() => setActiveType("all")}
                    >
                      <SlidersHorizontal size={17} />
                      <span>
                        <strong>All media</strong>
                        <small>{items.length}</small>
                      </span>
                      {activeType === "all" && (
                        <Check className="format-check" size={15} />
                      )}
                    </button>
                    {typeOptions.map(
                      ({ value, label, jpLabel, icon: Icon }) => {
                        const cover = previewCover(items, value);
                        return (
                          <button
                            type="button"
                            aria-pressed={activeType === value}
                            className={`${
                              activeType === value ? "active" : ""
                            } ${cover ? "has-preview" : ""}`}
                            style={cover
                              ? { backgroundImage: `url("${cover}")` }
                              : undefined}
                            onClick={() => setActiveType(value)}
                            key={value}
                          >
                            <Icon size={17} />
                            <span>
                              <strong>{label}</strong>
                              <small>
                                {jpLabel} ·{" "}
                                {items.filter((item) => item.type === value)
                                  .length}
                              </small>
                            </span>
                            {activeType === value && (
                              <Check className="format-check" size={15} />
                            )}
                          </button>
                        );
                      },
                    )}
                  </div>
                </div>
              </div>
            </section>

            <div className="library-layout" id="collection">
              <section className="library-main">
                <label className="library-search">
                  <Search size={20} />
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search your library..."
                  />
                </label>
                <div className="library-toolbar">
                  <div>
                    <h2>Your collection</h2>
                    <span>{filtered.length} results</span>
                  </div>
                  <div className="collection-controls">
                    <label className="toolbar-sort">
                      <span>Sort</span>
                      <select
                        value={sortBy}
                        onChange={(event) =>
                          setSortBy(event.target.value as LibrarySort)}
                      >
                        <option value="recent">Recently updated</option>
                        <option value="added">Recently added</option>
                        <option value="title">Title A–Z</option>
                        <option value="rating">Highest rated</option>
                      </select>
                    </label>
                    <button
                      type="button"
                      className="clear-filters"
                      disabled={activeType === "all" &&
                        activeStatus === "all" && !search}
                      onClick={() => {
                        setActiveType("all");
                        setActiveStatus("all");
                        setSearch("");
                      }}
                      title="Reset library filters"
                    >
                      <RotateCcw size={13} /> Reset
                    </button>
                  </div>
                </div>

                {error && (
                  <div className="error-banner">
                    <span>{error}</span>
                    <button
                      type="button"
                      onClick={() => setError("")}
                      aria-label="Dismiss error"
                    >
                      <X size={16} />
                    </button>
                  </div>
                )}
                {loading
                  ? (
                    <div className="empty-state">
                      <span className="empty-code">LOADING LIBRARY</span>
                      <p>Opening your collection...</p>
                    </div>
                  )
                  : filtered.length === 0
                  ? (
                    <div className="empty-state">
                      <span className="empty-jp">空</span>
                      <h3>
                        {items.length
                          ? "Nothing matches this view."
                          : "Your library is empty."}
                      </h3>
                      <p>
                        {items.length
                          ? "Clear a filter or search for another title."
                          : "Browse metadata providers or add your first title manually."}
                      </p>
                      <button
                        type="button"
                        className="primary-button"
                        onClick={() => setDiscoveryType(null)}
                      >
                        <CirclePlus size={17} />
                        {items.length
                          ? "Add another title"
                          : "Add your first title"}
                      </button>
                    </div>
                  )
                  : (
                    <div className="media-grid">
                      {filtered.map((item) => (
                        <MediaCard
                          item={item}
                          onOpen={() => openLocalDetail(item.id)}
                          onEdit={() => setManagedItem(item)}
                          onDelete={() => deleteItem(item)}
                          key={item.id}
                        />
                      ))}
                    </div>
                  )}
              </section>

              <aside className="library-panel" aria-label="Status filters">
                <div className="panel-title">
                  <span>Status</span>
                  <strong>{statusScope.length}</strong>
                </div>
                <div className="status-list">
                  <button
                    type="button"
                    aria-pressed={activeStatus === "all"}
                    className={`all ${activeStatus === "all" ? "active" : ""}`}
                    onClick={() => setActiveStatus("all")}
                  >
                    <span>All titles</span>
                    <strong>{statusScope.length}</strong>
                  </button>
                  {statusOptions.map((status) => (
                    <button
                      type="button"
                      aria-pressed={activeStatus === status.value}
                      className={`${status.value} ${
                        activeStatus === status.value ? "active" : ""
                      }`}
                      onClick={() => setActiveStatus(status.value)}
                      key={status.value}
                    >
                      <span>
                        {status.value === "planned"
                          ? plannedLabel(activeType)
                          : status.label}
                      </span>
                      <strong>
                        {statusScope.filter((item) =>
                          item.status === status.value
                        ).length}
                      </strong>
                    </button>
                  ))}
                </div>
              </aside>
            </div>
          </main>
        </>
      )}

      {view === "activity" && (
        <ActivityPage
          activities={activities}
          loading={activityLoading}
          items={items}
          onOpen={openLocalDetail}
        />
      )}

      {view === "settings" && (
        <SettingsPage
          status={anilistStatus}
          onManageAniList={() => setIntegrationOpen(true)}
          onImportAniList={() => setImportOpen(true)}
        />
      )}

      {view === "search" && (
        <GlobalSearchPage
          query={submittedQuery}
          input={globalQuery}
          catalogResults={catalogSearchResults}
          unavailableTypes={unavailableTypes}
          loading={globalLoading}
          error={globalError}
          onInput={setGlobalQuery}
          onSubmit={submitGlobalSearch}
          onBack={() => navigate("library")}
          onRetry={() => setSearchGeneration((current) => current + 1)}
          onOpenCatalog={openExternalDetail}
          onAddManually={openManualEntry}
        />
      )}

      {view === "detail" && (
        <MediaDetailPage
          selection={detail}
          loading={loading}
          media={detail?.kind === "local"
            ? items.find((item) => item.id === detail.mediaId)
            : undefined}
          existing={detail?.kind === "external"
            ? findExistingLibraryItem(detail.result, items)
            : undefined}
          metadataRefreshing={detail?.kind === "local" &&
            metadataRefreshingId === detail.mediaId}
          metadataError={detail?.kind === "local" &&
              metadataRefreshError?.id === detail.mediaId
            ? metadataRefreshError.message
            : ""}
          onBack={leaveDetail}
          onAdd={reviewDiscovery}
          onRefreshMetadata={refreshMediaMetadata}
          onManage={(item) => setManagedItem(item)}
          onDelete={async (item) => {
            if (await deleteItem(item)) navigate("library");
          }}
        />
      )}

      <footer className="site-footer">
        <div className="page-container">
          <span>HONNE / 個人メディア記録</span>
          <span>LOCAL-FIRST MEDIA LIBRARY</span>
        </div>
      </footer>
      {integrationOpen && (
        <AniListIntegrationModal
          status={anilistStatus}
          onClose={() => setIntegrationOpen(false)}
          onRefresh={refreshAniListStatus}
        />
      )}
      {importOpen && (
        <AniListImportModal
          integration={anilistStatus}
          onClose={() => setImportOpen(false)}
          onImport={importAniList}
        />
      )}
      {discoveryType !== undefined && (
        <DiscoveryModal
          initialType={discoveryType}
          onClose={() => setDiscoveryType(undefined)}
          onSelect={reviewDiscovery}
          onManual={openManualEntry}
        />
      )}
      {managedItem && (
        <ManageMediaModal
          key={managedItem.id}
          item={managedItem}
          onClose={() => setManagedItem(undefined)}
          onEditDetails={() => {
            setModalItem(managedItem);
            setManagedItem(undefined);
          }}
          onSave={(values) => saveManagedItem(managedItem, values)}
        />
      )}
      {modalItem !== undefined && (
        <MediaModal
          key={modalItem?.id || draftItem?.providerId || "manual"}
          item={modalItem}
          initial={draftItem}
          onClose={() => {
            setModalItem(undefined);
            setDraftItem(undefined);
          }}
          onSave={saveItem}
        />
      )}
    </div>
  );
}

function ActivityPage(
  { activities, loading, items, onOpen }: {
    activities: ActivityEvent[];
    loading: boolean;
    items: Media[];
    onOpen: (mediaId: number) => void;
  },
) {
  return (
    <main className="page-container standalone-page activity-page">
      <header className="page-heading">
        <span className="eyebrow">JOURNAL</span>
        <h1>Activity</h1>
        <p>A local history of the titles you add, finish, rate, and revisit.</p>
      </header>
      {loading
        ? <div className="page-empty">Loading your journal…</div>
        : activities.length === 0
        ? (
          <div className="page-empty">
            <Clock3 size={24} />
            <h2>No activity yet</h2>
            <p>Your next library change will start the journal.</p>
          </div>
        )
        : (
          <div className="activity-page-list">
            {activities.map((activity) => {
              const media = items.find((item) => item.id === activity.mediaId);
              const type = typeOptions.find((option) =>
                option.value === activity.mediaType
              );
              const Icon = type?.icon || Clock3;
              const canOpen = activity.action !== "deleted" && !!media;
              return (
                <button
                  type="button"
                  className={`activity-row ${activity.action}`}
                  disabled={!canOpen}
                  onClick={() => media && onOpen(media.id)}
                  key={activity.id}
                >
                  <span className="activity-icon">
                    <Icon size={16} />
                  </span>
                  <span className="activity-copy">
                    <strong>{activity.title}</strong>
                    <span>{activityDescription(activity)}</span>
                  </span>
                  <span className="activity-row-meta">
                    <small>{type?.label || activity.mediaType}</small>
                    <time dateTime={activity.occurredAt}>
                      {relativeTime(activity.occurredAt)}
                    </time>
                  </span>
                </button>
              );
            })}
          </div>
        )}
    </main>
  );
}

function SettingsPage(
  { status, onManageAniList, onImportAniList }: {
    status: AniListIntegrationStatus | null;
    onManageAniList: () => void;
    onImportAniList: () => void;
  },
) {
  return (
    <main className="page-container standalone-page settings-page">
      <header className="page-heading">
        <span className="eyebrow">HONNE CONFIGURATION</span>
        <h1>Settings</h1>
        <p>
          Manage integrations, backups, and the way this installation handles
          your data.
        </p>
      </header>
      <section className="settings-card">
        <div className="settings-card-icon">
          <Link2 size={21} />
        </div>
        <div className="settings-card-copy">
          <div className="settings-card-title">
            <div>
              <h2>AniList</h2>
              <p>One-way synchronization for anime, manga, and light novels.</p>
            </div>
            <span
              className={`connection-badge ${
                status?.connected ? "connected" : ""
              }`}
            >
              {status?.connected
                ? (
                  <>
                    <Check size={12} /> Connected
                  </>
                )
                : "Not connected"}
            </span>
          </div>
          {status?.connected
            ? (
              <div className="settings-integration-summary">
                {status.avatar && <img src={status.avatar} alt="" />}
                <strong>@{status.username}</strong>
                <span>{status.pending} pending</span>
                <span>{status.errors} errors</span>
                <span>
                  Remote deletion {status.deleteOnLocalDelete ? "on" : "off"}
                </span>
              </div>
            )
            : (
              <p className="settings-note">
                {status?.configured
                  ? "Connect the AniList account used by this Honne installation."
                  : "Add the AniList OAuth credentials to .env, then recreate the containers to enable connection."}
              </p>
            )}
          <div className="settings-actions">
            <button
              type="button"
              className="primary-button"
              onClick={onManageAniList}
            >
              <Cog size={14} /> Manage connection
            </button>
            <button type="button" onClick={onImportAniList}>
              Import AniList library
            </button>
          </div>
        </div>
      </section>
      <BackupSettingsCard />
    </main>
  );
}

function AniListIntegrationModal(
  { status, onClose, onRefresh }: {
    status: AniListIntegrationStatus | null;
    onClose: () => void;
    onRefresh: () => Promise<void>;
  },
) {
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");

  async function disconnect() {
    const discardPending = (status?.pending || 0) > 0;
    const message = discardPending
      ? `Discard ${status?.pending} pending AniList change(s) and disconnect? These changes will not be sent.`
      : "Disconnect AniList? Existing AniList entries will not be changed.";
    if (!globalThis.confirm(message)) return;
    setWorking(true);
    setError("");
    try {
      const suffix = discardPending ? "?discardPending=true" : "";
      await request<null>(`/api/integrations/anilist${suffix}`, {
        method: "DELETE",
      });
      await onRefresh();
    } catch (caught: unknown) {
      setError(errorMessage(caught));
    } finally {
      setWorking(false);
    }
  }

  async function retry() {
    setWorking(true);
    setError("");
    try {
      await request<{ queued: number }>("/api/integrations/anilist/retry", {
        method: "POST",
      });
      await onRefresh();
    } catch (caught: unknown) {
      setError(errorMessage(caught));
    } finally {
      setWorking(false);
    }
  }

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section
        className="integration-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="integration-title"
      >
        <header className="discovery-header">
          <div>
            <span className="eyebrow">ANILIST SYNC</span>
            <h2 id="integration-title">AniList connection</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close integration"
          >
            <X />
          </button>
        </header>
        <div className="integration-body">
          {!status
            ? <p>Loading connection status...</p>
            : !status.configured
            ? (
              <div className="integration-empty">
                <Link2 size={28} />
                <h3>OAuth is not configured</h3>
                <p>
                  Add the AniList client ID, secret, and redirect URL to the
                  server <code>.env</code>, then restart the containers.
                </p>
              </div>
            )
            : status.connected
            ? (
              <>
                <div className="integration-profile">
                  {status.avatar
                    ? <img src={status.avatar} alt="" />
                    : <span>A</span>}
                  <div>
                    <small>CONNECTED AS</small>
                    <strong>@{status.username}</strong>
                  </div>
                  <b>Connected</b>
                </div>
                <div className="integration-stats">
                  <span>
                    <strong>{status.pending}</strong> pending
                  </span>
                  <span>
                    <strong>{status.errors}</strong> with errors
                  </span>
                  <span>
                    <strong>{status.deleteOnLocalDelete ? "On" : "Off"}</strong>
                    {" "}
                    remote deletion
                  </span>
                </div>
                <p className="integration-note">
                  AniList-linked anime, manga, and light novels sync
                  automatically. Manual entries remain local until linked.
                </p>
              </>
            )
            : (
              <div className="integration-empty">
                <Link2 size={28} />
                <h3>Connect your AniList account</h3>
                <p>
                  Changes to linked titles will remain safely queued until you
                  authorize this installation.
                </p>
              </div>
            )}
          {error && <p className="form-error">{error}</p>}
        </div>
        <footer className="integration-footer">
          {(status?.connected || !!status?.pending) && (
            <button
              type="button"
              className="danger-button"
              onClick={disconnect}
              disabled={working}
            >
              {status?.pending ? "Discard queue & disconnect" : "Disconnect"}
            </button>
          )}
          {!!status?.pending && (
            <button type="button" onClick={retry} disabled={working}>
              <RefreshCw size={14} />Retry now
            </button>
          )}
          {status?.configured && !status.connected && (
            <button
              type="button"
              className="primary-button"
              onClick={() =>
                globalThis.location.assign("/api/integrations/anilist/connect")}
            >
              Connect AniList
            </button>
          )}
        </footer>
      </section>
    </div>
  );
}

function AniListImportModal(
  { integration, onClose, onImport }: {
    integration: AniListIntegrationStatus | null;
    onClose: () => void;
    onImport: (
      username: string,
      types: MediaType[],
      statuses: MediaStatus[],
    ) => Promise<AniListImportResult>;
  },
) {
  const [username, setUsername] = useState(integration?.username || "");
  const [preview, setPreview] = useState<AniListImportPreview | null>(null);
  const [selectedTypes, setSelectedTypes] = useState<MediaType[]>([]);
  const [selectedStatuses, setSelectedStatuses] = useState<MediaStatus[]>([]);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState("");

  async function loadPreview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (username.trim().length < 2) return;
    setLoading(true);
    setError("");
    setPreview(null);
    try {
      const result = await request<AniListImportPreview>(
        `/api/import/anilist?username=${encodeURIComponent(username.trim())}`,
      );
      setPreview(result);
      setUsername(result.username);
      setSelectedTypes(
        [...new Set(result.entries.map((entry) => entry.type))],
      );
      setSelectedStatuses(
        [...new Set(result.entries.map((entry) => entry.status))],
      );
    } catch (caught: unknown) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }

  function toggleType(value: MediaType) {
    setSelectedTypes((current) =>
      current.includes(value)
        ? current.filter((item) => item !== value)
        : [...current, value]
    );
  }

  function toggleStatus(value: MediaStatus) {
    setSelectedStatuses((current) =>
      current.includes(value)
        ? current.filter((item) => item !== value)
        : [...current, value]
    );
  }

  const selectedCount =
    preview?.entries.filter((entry) =>
      !entry.alreadyExists && selectedTypes.includes(entry.type) &&
      selectedStatuses.includes(entry.status)
    ).length || 0;
  const existingCount = preview?.entries.filter((entry) => entry.alreadyExists)
    .length || 0;

  async function confirmImport() {
    if (!preview || selectedCount === 0) return;
    setImporting(true);
    setError("");
    try {
      await onImport(preview.username, selectedTypes, selectedStatuses);
    } catch (caught: unknown) {
      setError(errorMessage(caught));
      setImporting(false);
    }
  }

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section
        className="import-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-title"
      >
        <header className="discovery-header">
          <div>
            <span className="eyebrow">ANILIST IMPORT</span>
            <h2 id="import-title">Bring your library with you</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close import">
            <X />
          </button>
        </header>

        <div className="import-body">
          <form className="import-search" onSubmit={loadPreview}>
            <label>
              <span>AniList username</span>
              <div>
                <input
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  placeholder="e.g. konan"
                  readOnly={!!integration?.connected}
                  autoFocus
                />
                <button
                  type="submit"
                  disabled={loading || username.trim().length < 2}
                >
                  {loading ? "Loading..." : "Preview list"}
                </button>
              </div>
            </label>
          </form>

          {error && <div className="discovery-error import-error">{error}</div>}
          {!preview && !loading && !error && (
            <div className="import-intro">
              <span className="profile-mark">A</span>
              <h3>Import a public AniList profile</h3>
              <p>
                Anime, manga, and light novels will keep their list status,
                progress, score, notes, covers, and metadata.
              </p>
            </div>
          )}

          {preview && (
            <div className="import-preview">
              <div className="import-profile">
                {preview.avatar
                  ? <img src={preview.avatar} alt="" />
                  : <span>{preview.username.slice(0, 1).toUpperCase()}</span>}
                <div>
                  <strong>{preview.username}</strong>
                  <small>
                    {preview.entries.length} public list entries ·{" "}
                    {existingCount} already here
                  </small>
                </div>
                <div className="preview-covers" aria-hidden="true">
                  {preview.entries.filter((entry) => entry.coverUrl).slice(0, 4)
                    .map((entry) => (
                      <span
                        style={{ backgroundImage: `url("${entry.coverUrl}")` }}
                        key={entry.providerId}
                      />
                    ))}
                </div>
              </div>

              <fieldset>
                <legend>Media types</legend>
                <div className="import-options">
                  {typeOptions.filter((type) =>
                    ["anime", "manga", "light_novel"].includes(type.value)
                  ).map((type) => {
                    const count = preview.entries.filter((entry) =>
                      entry.type === type.value
                    ).length;
                    return (
                      <label key={type.value}>
                        <input
                          type="checkbox"
                          checked={selectedTypes.includes(type.value)}
                          onChange={() => toggleType(type.value)}
                        />
                        <span>
                          {type.label}
                          <small>{count}</small>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>

              <fieldset>
                <legend>List statuses</legend>
                <div className="import-options statuses">
                  {statusOptions.map((status) => {
                    const count = preview.entries.filter((entry) =>
                      entry.status === status.value
                    ).length;
                    return (
                      <label key={status.value}>
                        <input
                          type="checkbox"
                          checked={selectedStatuses.includes(status.value)}
                          onChange={() => toggleStatus(status.value)}
                        />
                        <span>
                          {status.label}
                          <small>{count}</small>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>

              <div className="import-summary">
                <span>{selectedCount} new titles selected</span>
                <small>Existing AniList IDs are skipped automatically.</small>
              </div>
            </div>
          )}
        </div>

        <footer className="import-footer">
          <button type="button" onClick={onClose}>Cancel</button>
          <button
            type="button"
            className="primary-button"
            onClick={confirmImport}
            disabled={!preview || selectedCount === 0 || importing}
          >
            {importing ? "Importing..." : `Import ${selectedCount} titles`}
          </button>
        </footer>
      </section>
    </div>
  );
}

function DiscoveryModal(
  { initialType, onClose, onSelect, onManual }: {
    initialType: MediaType | null;
    onClose: () => void;
    onSelect: (result: DiscoveryResult) => void;
    onManual: () => void;
  },
) {
  const [mediaType, setMediaType] = useState<MediaType | null>(initialType);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [results, setResults] = useState<DiscoveryResult[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const normalizedQuery = query.trim();
    if (!mediaType || normalizedQuery.length < 2) {
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      setError("");
      const params = new URLSearchParams({
        type: mediaType,
        q: normalizedQuery,
        page: String(page),
      });
      request<DiscoveryResponse>(`/api/discovery/search?${params}`, {
        signal: controller.signal,
      })
        .then((response) => {
          setResults((current) =>
            page === 1 ? response.results : [...current, ...response.results]
          );
          setHasMore(response.hasMore);
        })
        .catch((caught: unknown) => {
          if (caught instanceof DOMException && caught.name === "AbortError") {
            return;
          }
          setError(errorMessage(caught));
        })
        .finally(() => setLoading(false));
    }, 300);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [mediaType, query, page]);

  function chooseType(value: MediaType) {
    setMediaType(value);
    setQuery("");
    setResults([]);
    setPage(1);
    setHasMore(false);
    setError("");
  }

  function updateQuery(value: string) {
    setQuery(value);
    setResults([]);
    setPage(1);
    setHasMore(false);
  }

  return (
    <div
      className="modal-backdrop discovery-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section
        className="discovery-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="discovery-title"
      >
        <header className="discovery-header">
          <div>
            <span className="eyebrow">DISCOVER MEDIA</span>
            <h2 id="discovery-title">Find something to add</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close discovery">
            <X />
          </button>
        </header>

        <div className="discovery-types" aria-label="Media type">
          {typeOptions.map(({ value, label, icon: Icon }) => (
            <button
              type="button"
              className={mediaType === value ? "selected" : ""}
              onClick={() => chooseType(value)}
              key={value}
            >
              <Icon size={16} />
              {label}
            </button>
          ))}
        </div>

        <div className="discovery-body">
          {!mediaType
            ? (
              <div className="discovery-prompt">
                <Search size={28} />
                <h3>What kind of title are you looking for?</h3>
                <p>Choose a media type so we can search the right catalog.</p>
              </div>
            )
            : (
              <>
                <label className="discovery-search">
                  <Search size={20} />
                  <input
                    value={query}
                    onChange={(event) => updateQuery(event.target.value)}
                    placeholder={`Search for ${
                      typeOptions.find((type) => type.value === mediaType)
                        ?.label
                        .toLowerCase()
                    }...`}
                    autoFocus
                  />
                  {loading && <span>Searching...</span>}
                </label>

                {error && <div className="discovery-error">{error}</div>}
                {query.trim().length < 2
                  ? (
                    <div className="discovery-hint">
                      Enter at least two characters to search.
                    </div>
                  )
                  : !loading && !error && results.length === 0
                  ? (
                    <div className="discovery-hint">
                      No results found. Try another title or add it manually.
                    </div>
                  )
                  : (
                    <div className="discovery-results">
                      {results.map((result) => (
                        <button
                          type="button"
                          className="discovery-result"
                          onClick={() => onSelect(result)}
                          key={`${result.provider}-${result.providerId}`}
                        >
                          <span
                            className="result-cover"
                            style={{
                              backgroundImage: result.coverUrl
                                ? `url("${result.coverUrl}")`
                                : undefined,
                            }}
                          />
                          <span className="result-copy">
                            <strong>{result.title}</strong>
                            {result.originalTitle &&
                              result.originalTitle !== result.title && (
                              <small>{result.originalTitle}</small>
                            )}
                            <span>
                              {[result.releaseYear, result.subtitle]
                                .filter(Boolean).join(" · ") ||
                                "Metadata available"}
                            </span>
                            {result.description && <p>{result.description}</p>}
                          </span>
                          <span className="result-meta">
                            {result.communityRating
                              ? (
                                <b>
                                  <Star size={12} fill="currentColor" />
                                  {result.communityRating.toFixed(1)}
                                </b>
                              )
                              : null}
                            <small>{result.provider.replace("_", " ")}</small>
                            <em>Review +</em>
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                {hasMore && (
                  <button
                    type="button"
                    className="load-more"
                    onClick={() => setPage((current) => current + 1)}
                    disabled={loading}
                  >
                    {loading ? "Loading..." : "Load more results"}
                  </button>
                )}
              </>
            )}
        </div>

        <footer className="discovery-footer">
          <span>Can’t find it?</span>
          <button type="button" onClick={onManual}>Add manually</button>
        </footer>
      </section>
    </div>
  );
}

function MediaCard(
  { item, onOpen, onEdit, onDelete }: {
    item: Media;
    onOpen: () => void;
    onEdit: () => void;
    onDelete: () => void;
  },
) {
  const type = typeOptions.find(({ value }) => value === item.type);
  const status = statusOptions.find(({ value }) => value === item.status);
  const Icon = type?.icon || BookOpen;
  const percentage = item.total > 0
    ? Math.min(100, Math.round((item.progress / item.total) * 100))
    : item.status === "completed"
    ? 100
    : 0;

  return (
    <article className="media-card">
      <button
        type="button"
        className={`cover ${item.coverUrl ? "" : "fallback-cover"}`}
        style={{
          backgroundImage: item.coverUrl
            ? `url("${item.coverUrl.replaceAll('"', "")}")`
            : undefined,
        }}
        onClick={onOpen}
        aria-label={`View details for ${item.title}. Status: ${
          statusLabel(item.status, item.type)
        }`}
      >
        {!item.coverUrl && (
          <span className="fallback-label">
            <Icon size={18} /> {type?.label}
          </span>
        )}
        <span className={`status ${item.status}`}>
          {status ? statusLabel(status.value, item.type) : ""}
        </span>
      </button>
      <div className="card-content">
        <div className="card-title">
          <div>
            <span className="media-type">{type?.label}</span>
            {item.syncStatus && (
              <span
                className={`sync-state ${item.syncStatus}`}
                title={item.syncError || "AniList synchronization status"}
              >
                {item.syncStatus.replace("_", " ")}
              </span>
            )}
            <h3 title={item.title}>{item.title}</h3>
          </div>
          {item.rating > 0 && (
            <span className="rating">
              <Star size={14} fill="currentColor" /> {item.rating}
            </span>
          )}
        </div>
        <div className="progress-label">
          <span>
            {item.status === "planned"
              ? "Not started"
              : item.status === "completed"
              ? "Completed"
              : "Progress"}
          </span>
          <strong>
            {item.total > 0
              ? `${item.progress} / ${item.total}`
              : item.progress || "—"}
          </strong>
        </div>
        <div className="progress-track">
          <span style={{ width: `${percentage}%` }} />
        </div>
        {item.notes && <p className="notes">{item.notes}</p>}
        <div className="card-actions">
          <button type="button" onClick={onEdit}>
            <Pencil size={15} /> Update
          </button>
          <button
            type="button"
            className="delete"
            onClick={onDelete}
            aria-label={`Delete ${item.title}`}
          >
            <Trash2 size={16} />
          </button>
        </div>
      </div>
    </article>
  );
}

function MediaModal(
  { item, initial, onClose, onSave }: {
    item: Media | null;
    initial?: MediaInput;
    onClose: () => void;
    onSave: (values: MediaInput) => Promise<void>;
  },
) {
  const [form, setForm] = useState<MediaInput>(
    item ? mediaToInput(item) : initial || emptyForm,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const previewCover = safeHTTPURL(initial?.coverUrl || item?.coverUrl || "");

  useEffect(() => {
    triggerRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    titleRef.current?.focus();

    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]",
        ) || [],
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      triggerRef.current?.focus();
    };
  }, []);

  function change(
    event: ChangeEvent<
      HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
    >,
  ) {
    const { name, value, type } = event.target;
    setForm((current) => ({
      ...current,
      [name]: type === "number" ? Number(value) : value,
    }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      await onSave(form);
    } catch (caught: unknown) {
      setError(errorMessage(caught));
      setSaving(false);
    }
  }

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div
        ref={dialogRef}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        aria-busy={saving}
      >
        <div className="modal-header">
          <div>
            <span className="eyebrow">RECORD YOUR JOURNEY</span>
            <h2 id="modal-title">{item ? "Update media" : "Add media"}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close">
            <X />
          </button>
        </div>
        {(initial?.provider || item?.provider) && (
          <div className="metadata-preview">
            {previewCover && (
              <span
                className="metadata-cover"
                style={{ backgroundImage: `url("${previewCover}")` }}
              />
            )}
            <div>
              <span className="eyebrow">
                {(initial?.provider || item?.provider || "").replace("_", " ")}
                {(initial?.releaseYear || item?.releaseYear)
                  ? ` / ${initial?.releaseYear || item?.releaseYear}`
                  : ""}
              </span>
              {(initial?.originalTitle || item?.originalTitle) && (
                <strong>{initial?.originalTitle || item?.originalTitle}</strong>
              )}
              {(initial?.description || item?.description) && (
                <p>{initial?.description || item?.description}</p>
              )}
            </div>
          </div>
        )}
        <form onSubmit={submit}>
          <label className="wide">
            Title{" "}
            <input
              ref={titleRef}
              name="title"
              value={form.title}
              onChange={change}
              required
              placeholder="e.g. The Lord of the Rings"
            />
          </label>
          <label>
            Type{" "}
            <select
              name="type"
              value={form.type}
              onChange={change}
              disabled={Boolean(item?.provider || initial?.provider)}
            >
              {typeOptions.map((type) => (
                <option value={type.value} key={type.value}>
                  {type.label}
                </option>
              ))}
            </select>
            {(item?.provider || initial?.provider) && (
              <small>Type is fixed by the catalog provider.</small>
            )}
          </label>
          <label>
            Status{" "}
            <select name="status" value={form.status} onChange={change}>
              {statusOptions.map((status) => (
                <option value={status.value} key={status.value}>
                  {statusLabel(status.value, form.type)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Current progress{" "}
            <input
              type="number"
              name="progress"
              min="0"
              value={form.progress}
              onChange={change}
            />
          </label>
          <label>
            Total{" "}
            <input
              type="number"
              name="total"
              min="0"
              value={form.total}
              onChange={change}
            />
            <small>Episodes, pages, or chapters</small>
          </label>
          <label>
            Rating{" "}
            <input
              type="number"
              name="rating"
              min="0"
              max="10"
              value={form.rating}
              onChange={change}
            />
            <small>From 0 to 10</small>
          </label>
          <label>
            Cover URL{" "}
            <input
              type="url"
              name="coverUrl"
              value={form.coverUrl}
              onChange={change}
              placeholder="https://..."
            />
          </label>
          <label className="wide">
            Notes{" "}
            <textarea
              name="notes"
              value={form.notes}
              onChange={change}
              rows={3}
              placeholder="What do you think so far?"
            />
          </label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="form-actions">
            <button type="button" onClick={onClose}>Cancel</button>
            <button
              type="submit"
              className="primary-button"
              aria-disabled={saving}
            >
              {saving
                ? "Saving..."
                : item
                ? "Save changes"
                : "Add to collection"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default App;
