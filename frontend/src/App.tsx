import { type ChangeEvent, type FormEvent, useEffect, useState } from "react";
import {
  BookOpen,
  CirclePlus,
  Clapperboard,
  Film,
  Library,
  Link2,
  type LucideIcon,
  Menu,
  Pencil,
  RefreshCw,
  Search,
  Sparkles,
  Star,
  Trash2,
  Tv,
  X,
} from "lucide-react";

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
}

interface Media extends MediaInput {
  id: number;
  providerListEntryId?: number;
  syncStatus?: "local_only" | "waiting_auth" | "pending" | "synced" | "error";
  syncError?: string;
  createdAt: string;
  updatedAt: string;
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

interface DiscoveryResult {
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
  };
}

function categoryCover(items: Media[], mediaType: MediaType): string {
  const covers = items.filter((item) =>
    item.type === mediaType && item.coverUrl.trim()
  );
  if (covers.length === 0) return "";

  const seed = covers.reduce(
    (total, item) => total + item.id,
    mediaType.length,
  );
  return covers[seed % covers.length].coverUrl.replaceAll('"', "");
}

function App() {
  const [items, setItems] = useState<Media[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [activeType, setActiveType] = useState<MediaType | "all">("all");
  const [activeStatus, setActiveStatus] = useState<MediaStatus | "all">("all");
  const [modalItem, setModalItem] = useState<Media | null | undefined>(
    undefined,
  );
  const [draftItem, setDraftItem] = useState<MediaInput | undefined>(undefined);
  const [discoveryType, setDiscoveryType] = useState<
    MediaType | null | undefined
  >(undefined);
  const [menuOpen, setMenuOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [integrationOpen, setIntegrationOpen] = useState(false);
  const [anilistStatus, setAniListStatus] = useState<AniListIntegrationStatus | null>(null);

  useEffect(() => {
    let active = true;
    async function refresh(initial: boolean) {
      try {
        const [library, integration] = await Promise.all([
          request<Media[]>("/api/media"),
          request<AniListIntegrationStatus>("/api/integrations/anilist"),
        ]);
        if (active) {
          setItems(library);
          setAniListStatus(integration);
        }
      } catch (caught: unknown) {
        if (active && initial) setError(errorMessage(caught));
      } finally {
        if (active && initial) setLoading(false);
      }
    }
    void refresh(true);
    const timer = setInterval(() => void refresh(false), 15_000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  async function refreshAniListStatus() {
    const status = await request<AniListIntegrationStatus>(
      "/api/integrations/anilist",
    );
    setAniListStatus(status);
  }

  const filtered = items.filter((item) => {
    const matchesSearch = item.title.toLocaleLowerCase("en").includes(
      search.toLocaleLowerCase("en"),
    );
    return matchesSearch &&
      (activeType === "all" || item.type === activeType) &&
      (activeStatus === "all" || item.status === activeStatus);
  });

  const inProgress =
    items.filter((item) => item.status === "in_progress").length;
  const completed = items.filter((item) => item.status === "completed").length;

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
          setModalItem(existing);
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
    setModalItem(undefined);
    setDraftItem(undefined);
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
    setImportOpen(false);
    return result;
  }

  async function deleteItem(item: Media) {
    const hasRemoteSync = !!item.providerListEntryId ||
      ["waiting_auth", "pending", "synced", "error"].includes(
        item.syncStatus || "",
      );
    const removesFromAniList = item.provider === "anilist" && hasRemoteSync &&
      anilistStatus?.configured && anilistStatus.deleteOnLocalDelete;
    const message = removesFromAniList
      ? `Remove “${item.title}” from Honne and your AniList list?`
      : `Remove “${item.title}” from your collection?`;
    if (!globalThis.confirm(message)) return;
    try {
      await request<null>(`/api/media/${item.id}`, { method: "DELETE" });
      setItems((current) => current.filter(({ id }) => id !== item.id));
      void refreshAniListStatus().catch(() => {});
    } catch (caught: unknown) {
      setError(errorMessage(caught));
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar" id="top">
        <div className="topbar-inner">
          <a className="brand" href="#top" aria-label="Honne, home">
            <span className="brand-glyph">本音</span>
            <span>honne</span>
          </a>
          <nav className={menuOpen ? "main-nav open" : "main-nav"}>
            <a
              className="active"
              href="#collection"
              onClick={() => setMenuOpen(false)}
            >
              Library
            </a>
            <a
              href="#browse"
              onClick={() => {
                setDiscoveryType(null);
                setMenuOpen(false);
              }}
            >
              Browse
            </a>
            <a href="#collection" onClick={() => setMenuOpen(false)}>
              Activity
            </a>
            <button
              type="button"
              className="nav-import"
              onClick={() => {
                setIntegrationOpen(true);
                setMenuOpen(false);
              }}
            >
              <Link2 size={13} />
              {anilistStatus?.connected
                ? `@${anilistStatus.username}`
                : "AniList"}
              {!!anilistStatus?.pending && <span>{anilistStatus.pending}</span>}
            </button>
            <button
              type="button"
              className="nav-import"
              onClick={() => {
                setImportOpen(true);
                setMenuOpen(false);
              }}
            >
              Import AniList
            </button>
            <button
              type="button"
              className="mobile-add"
              onClick={() => {
                setDiscoveryType(null);
                setMenuOpen(false);
              }}
            >
              <CirclePlus size={16} />Add title
            </button>
          </nav>
          <label className="nav-search">
            <Search size={15} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search library"
            />
          </label>
          <button
            type="button"
            className="top-add"
            onClick={() => setDiscoveryType(null)}
          >
            <CirclePlus size={16} />Add title
          </button>
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

      <section className="library-hero">
        <div className="hero-overlay" />
        <div className="page-container hero-content">
          <span className="profile-mark">本音</span>
          <div>
            <span className="hero-kicker">PERSONAL MEDIA LIBRARY</span>
            <h1>My Library</h1>
            <p>
              {items.length} titles · {inProgress} in progress · {completed}
              {" "}
              completed
            </p>
          </div>
        </div>
      </section>

      <nav className="library-tabs">
        <div className="page-container">
          <a
            className={activeStatus === "all" ? "active" : ""}
            href="#collection"
            onClick={() => setActiveStatus("all")}
          >
            All titles
          </a>
          <a
            className={activeStatus === "in_progress" ? "active" : ""}
            href="#collection"
            onClick={() => setActiveStatus("in_progress")}
          >
            In progress <span>{inProgress}</span>
          </a>
          <a
            className={activeStatus === "planned" ? "active" : ""}
            href="#collection"
            onClick={() => setActiveStatus("planned")}
          >
            Planned
          </a>
          <a
            className={activeStatus === "completed" ? "active" : ""}
            href="#collection"
            onClick={() => setActiveStatus("completed")}
          >
            Completed <span>{completed}</span>
          </a>
        </div>
      </nav>

      <main className="page-container content" id="browse">
        <section className="browse-section">
          <header className="section-heading">
            <div>
              <span className="eyebrow">BROWSE</span>
              <h2>Explore by format</h2>
            </div>
            <p>Choose a format to narrow your library.</p>
          </header>
          <div className="format-row">
            {typeOptions.map(({ value, label, jpLabel, icon: Icon }) => {
              const count = items.filter((item) => item.type === value).length;
              const cover = categoryCover(items, value);
              return (
                <a
                  href="#collection"
                  className={`format-card ${cover ? "has-cover" : "is-empty"}`}
                  style={cover
                    ? { backgroundImage: `url("${cover}")` }
                    : undefined}
                  onClick={(event) => {
                    event.preventDefault();
                    setDiscoveryType(value);
                  }}
                  key={value}
                >
                  <span className="format-shade" />
                  {!cover && <Icon className="format-icon" size={25} />}
                  <span className="format-copy">
                    <small>{jpLabel}</small>
                    <strong>{label}</strong>
                    <span>{count} titles</span>
                  </span>
                </a>
              );
            })}
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
              <label htmlFor="status-mobile">
                Show{" "}
                <select
                  id="status-mobile"
                  value={activeStatus}
                  onChange={(event) =>
                    setActiveStatus(event.target.value as MediaStatus | "all")}
                >
                  <option value="all">All statuses</option>
                  {statusOptions.map((status) => (
                    <option value={status.value} key={status.value}>
                      {status.label}
                    </option>
                  ))}
                </select>
              </label>
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
                      : "Add a title manually now. Provider search will be added next."}
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
                      onEdit={() => setModalItem(item)}
                      onDelete={() => deleteItem(item)}
                      key={item.id}
                    />
                  ))}
                </div>
              )}
          </section>

          <aside className="library-panel">
            <div className="panel-title">
              <span>My collection</span>
              <strong>{items.length}</strong>
            </div>
            <div className="status-list">
              <button
                type="button"
                className={`all ${activeStatus === "all" ? "active" : ""}`}
                onClick={() => setActiveStatus("all")}
              >
                <span>All titles</span>
                <strong>{items.length}</strong>
              </button>
              {statusOptions.map((status) => {
                const count = items.filter((item) =>
                  item.status === status.value
                ).length;
                return (
                  <button
                    type="button"
                    className={`${status.value} ${
                      activeStatus === status.value ? "active" : ""
                    }`}
                    onClick={() => setActiveStatus(status.value)}
                    key={status.value}
                  >
                    <span>{status.label}</span>
                    <strong>{count}</strong>
                  </button>
                );
              })}
            </div>
            <div className="panel-section">
              <h3>Media types</h3>
              <div className="type-list">
                <button
                  type="button"
                  className={activeType === "all" ? "active" : ""}
                  onClick={() => setActiveType("all")}
                >
                  All media
                </button>
                {typeOptions.map((type) => (
                  <button
                    type="button"
                    className={activeType === type.value ? "active" : ""}
                    onClick={() => setActiveType(type.value)}
                    key={type.value}
                  >
                    {type.label}
                    <span>
                      {items.filter((item) => item.type === type.value).length}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </aside>
        </div>
      </main>

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
      await request<null>(`/api/integrations/anilist${suffix}`, { method: "DELETE" });
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
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="integration-modal" role="dialog" aria-modal="true" aria-labelledby="integration-title">
        <header className="discovery-header">
          <div>
            <span className="eyebrow">ANILIST SYNC</span>
            <h2 id="integration-title">AniList connection</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close integration"><X /></button>
        </header>
        <div className="integration-body">
          {!status
            ? <p>Loading connection status...</p>
            : !status.configured
            ? (
              <div className="integration-empty">
                <Link2 size={28} />
                <h3>OAuth is not configured</h3>
                <p>Add the AniList client ID, secret, and redirect URL to the server <code>.env</code>, then restart the containers.</p>
              </div>
            )
            : status.connected
            ? (
              <>
                <div className="integration-profile">
                  {status.avatar ? <img src={status.avatar} alt="" /> : <span>A</span>}
                  <div><small>CONNECTED AS</small><strong>@{status.username}</strong></div>
                  <b>Connected</b>
                </div>
                <div className="integration-stats">
                  <span><strong>{status.pending}</strong> pending</span>
                  <span><strong>{status.errors}</strong> with errors</span>
                  <span><strong>{status.deleteOnLocalDelete ? "On" : "Off"}</strong> remote deletion</span>
                </div>
                <p className="integration-note">AniList-linked anime, manga, and light novels sync automatically. Manual entries remain local until linked.</p>
              </>
            )
            : (
              <div className="integration-empty">
                <Link2 size={28} />
                <h3>Connect your AniList account</h3>
                <p>Changes to linked titles will remain safely queued until you authorize this installation.</p>
              </div>
            )}
          {error && <p className="form-error">{error}</p>}
        </div>
        <footer className="integration-footer">
          {(status?.connected || !!status?.pending) && <button type="button" className="danger-button" onClick={disconnect} disabled={working}>
            {status?.pending ? "Discard queue & disconnect" : "Disconnect"}
          </button>}
          {!!status?.pending && <button type="button" onClick={retry} disabled={working}><RefreshCw size={14} />Retry now</button>}
          {status?.configured && !status.connected && (
            <button type="button" className="primary-button" onClick={() => globalThis.location.assign("/api/integrations/anilist/connect")}>Connect AniList</button>
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
  { item, onEdit, onDelete }: {
    item: Media;
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
      <div
        className={`cover ${item.coverUrl ? "" : "fallback-cover"}`}
        style={{
          backgroundImage: item.coverUrl
            ? `url("${item.coverUrl.replaceAll('"', "")}")`
            : undefined,
        }}
      >
        {!item.coverUrl && (
          <span className="fallback-label">
            <Icon size={18} /> {type?.label}
          </span>
        )}
        <span className={`status ${item.status}`}>{status?.label}</span>
      </div>
      <div className="card-content">
        <div className="card-title">
          <div>
            <span className="media-type">{type?.label}</span>
            {item.syncStatus && (
              <span className={`sync-state ${item.syncStatus}`} title={item.syncError || "AniList synchronization status"}>
                {item.syncStatus.replace("_", " ")}
              </span>
            )}
            <h3>{item.title}</h3>
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
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
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
            {(initial?.coverUrl || item?.coverUrl) && (
              <span
                className="metadata-cover"
                style={{
                  backgroundImage: `url("${
                    initial?.coverUrl || item?.coverUrl || ""
                  }")`,
                }}
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
              name="title"
              value={form.title}
              onChange={change}
              required
              autoFocus
              placeholder="e.g. The Lord of the Rings"
            />
          </label>
          <label>
            Type{" "}
            <select name="type" value={form.type} onChange={change}>
              {typeOptions.map((type) => (
                <option value={type.value} key={type.value}>
                  {type.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Status{" "}
            <select name="status" value={form.status} onChange={change}>
              {statusOptions.map((status) => (
                <option value={status.value} key={status.value}>
                  {status.label}
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
          {error && <p className="form-error">{error}</p>}
          <div className="form-actions">
            <button type="button" onClick={onClose}>Cancel</button>
            <button type="submit" className="primary-button" disabled={saving}>
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
