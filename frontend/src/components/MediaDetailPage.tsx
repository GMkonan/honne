import { useEffect, useState } from "react";
import {
  ArrowLeft,
  BookOpen,
  CirclePlus,
  Clapperboard,
  ExternalLink,
  Film,
  Library,
  type LucideIcon,
  Pencil,
  RefreshCw,
  Sparkles,
  Star,
  Trash2,
  Tv,
} from "lucide-react";
import {
  type SearchCatalogResult,
  type SearchMediaCredit,
  type SearchMediaType,
} from "./GlobalSearchBox.tsx";

export type DetailMediaStatus =
  | "planned"
  | "in_progress"
  | "completed"
  | "paused"
  | "dropped";

export interface DetailLibraryMedia {
  id: number;
  title: string;
  type: SearchMediaType;
  status: DetailMediaStatus;
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
  createdAt: string;
  updatedAt: string;
}

type DetailSelection =
  | { kind: "local"; mediaId: number }
  | { kind: "external"; result: SearchCatalogResult };

interface MediaDetailPageProps {
  selection: DetailSelection | null;
  loading: boolean;
  media?: DetailLibraryMedia;
  existing?: DetailLibraryMedia;
  metadataRefreshing: boolean;
  metadataError: string;
  onBack: () => void;
  onAdd: (result: SearchCatalogResult) => void;
  onRefreshMetadata: (item: DetailLibraryMedia) => void;
  onManage: (item: DetailLibraryMedia) => void;
  onDelete: (item: DetailLibraryMedia) => void;
}

const typeDetails: Record<
  SearchMediaType,
  { label: string; icon: LucideIcon }
> = {
  anime: { label: "Anime", icon: Sparkles },
  series: { label: "Series", icon: Tv },
  movie: { label: "Movie", icon: Film },
  book: { label: "Book", icon: BookOpen },
  manga: { label: "Manga", icon: Library },
  light_novel: { label: "Light novel", icon: Clapperboard },
};

function plannedLabel(type: SearchMediaType): string {
  return ["book", "manga", "light_novel"].includes(type)
    ? "Plan to read"
    : "Plan to watch";
}

function statusLabel(status: DetailMediaStatus, type: SearchMediaType): string {
  if (status === "planned") return plannedLabel(type);
  if (status === "in_progress") return "In progress";
  return status[0].toUpperCase() + status.slice(1);
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

function DetailCover(
  { title, coverURL, icon: TypeIcon }: {
    title: string;
    coverURL?: string;
    icon: LucideIcon;
  },
) {
  const safeCoverURL = safeHTTPURL(coverURL?.replaceAll('"', ""));
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [safeCoverURL]);
  const showCover = safeCoverURL && !failed;

  return (
    <div className={`detail-cover ${showCover ? "" : "fallback-cover"}`}>
      {showCover
        ? (
          <img
            src={safeCoverURL}
            alt={`${title} cover`}
            onError={() => setFailed(true)}
          />
        )
        : (
          <span role="img" aria-label={`No cover available for ${title}`}>
            <TypeIcon size={52} />
          </span>
        )}
    </div>
  );
}

function providerLabel(provider: string): string {
  return provider
    ? provider.replaceAll("_", " ").replace(
      /\b\w/gu,
      (letter) => letter.toUpperCase(),
    )
    : "Local entry";
}

function progressLabel(item: DetailLibraryMedia): string {
  if (item.total > 0) return `${item.progress} of ${item.total}`;
  return item.progress > 0 ? String(item.progress) : "Not started";
}

function totalLabel(type: SearchMediaType, total: number): string {
  const unit = type === "anime" || type === "series"
    ? "episodes"
    : type === "movie"
    ? "parts"
    : type === "book"
    ? "pages"
    : "chapters";
  return `${total} ${unit}`;
}

const releaseStatusLabels: Record<string, string> = {
  announced: "Announced",
  upcoming: "Upcoming",
  releasing: "Releasing",
  finished: "Finished",
  cancelled: "Cancelled",
  hiatus: "On hiatus",
};

const monthLabels = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function formatCatalogDate(value?: string): string {
  if (!value) return "";
  const [year, month, day] = value.split("-").map(Number);
  if (!year) return "";
  if (!month) return String(year);
  if (!day) return `${monthLabels[month - 1] || month} ${year}`;
  return `${monthLabels[month - 1] || month} ${day}, ${year}`;
}

function dateRangeLabel(start?: string, end?: string): string {
  const formattedStart = formatCatalogDate(start);
  const formattedEnd = formatCatalogDate(end);
  if (formattedStart && formattedEnd) {
    return `${formattedStart} – ${formattedEnd}`;
  }
  return formattedStart || formattedEnd;
}

function durationLabel(type: SearchMediaType, minutes: number): string {
  if (!minutes) return "";
  return type === "anime" || type === "series"
    ? `${minutes} min / episode`
    : `${minutes} min`;
}

function LibraryPanel(
  { item, actionLabel, onManage }: {
    item: DetailLibraryMedia;
    actionLabel: string;
    onManage: (item: DetailLibraryMedia) => void;
  },
) {
  return (
    <section className="detail-library-panel" aria-label="Your Library">
      <div className="detail-record-heading">
        <span className="eyebrow">PERSONAL RECORD</span>
        <span className={`detail-status ${item.status}`}>
          <span aria-hidden="true" />
          {statusLabel(item.status, item.type)}
        </span>
      </div>
      <dl className="detail-personal-stats">
        <div>
          <dt>Progress</dt>
          <dd>{progressLabel(item)}</dd>
        </div>
        <div>
          <dt>Your rating</dt>
          <dd>{item.rating > 0 ? `${item.rating}/10` : "Not rated"}</dd>
        </div>
      </dl>
      {item.notes && (
        <div className="detail-review">
          <span>Review / notes</span>
          <p title={item.notes}>{item.notes}</p>
        </div>
      )}
      <button
        type="button"
        className="primary-button"
        onClick={() => onManage(item)}
      >
        <Pencil size={16} /> {actionLabel}
      </button>
    </section>
  );
}

export function MediaDetailPage(
  {
    selection,
    loading,
    media,
    existing,
    metadataRefreshing,
    metadataError,
    onBack,
    onAdd,
    onRefreshMetadata,
    onManage,
    onDelete,
  }: MediaDetailPageProps,
) {
  if (!selection || (selection.kind === "local" && !media)) {
    const waitingForLibrary = loading && selection?.kind === "local";
    return (
      <main className="page-container standalone-page">
        <div className="page-empty">
          <h1>{waitingForLibrary ? "Loading title…" : "Title not found"}</h1>
          <button type="button" className="primary-button" onClick={onBack}>
            Back to library
          </button>
        </div>
      </main>
    );
  }

  const source = selection.kind === "local" ? media : selection.result;
  if (!source) return null;
  const localMedia = selection.kind === "local" ? media : undefined;
  const localItem = localMedia || existing;
  const type = typeDetails[source.type] || {
    label: "Media",
    icon: BookOpen,
  };
  const TypeIcon = type.icon;
  const providerURL = safeHTTPURL(source.providerUrl);
  const releasePeriod = dateRangeLabel(source.startDate, source.endDate);
  const catalogTotal = source.catalogTotal ||
    (selection.kind === "external" ? source.total || 0 : 0);
  const genres = Array.isArray(source.genres)
    ? source.genres.filter((genre): genre is string =>
      typeof genre === "string"
    )
      .slice(0, 12)
    : [];
  const credits = Array.isArray(source.credits)
    ? source.credits.filter((credit): credit is SearchMediaCredit =>
      Boolean(
        credit && typeof credit.name === "string" &&
          typeof credit.role === "string",
      )
    ).slice(0, 12)
    : [];
  const catalogFacts = [
    type.label,
    source.format ||
    (selection.kind === "external" ? selection.result.subtitle || "" : ""),
    releaseStatusLabels[source.releaseStatus || ""] || "",
    releasePeriod || (source.releaseYear ? String(source.releaseYear) : ""),
    catalogTotal > 0 ? totalLabel(source.type, catalogTotal) : "",
    durationLabel(source.type, source.durationMinutes || 0),
    providerLabel(source.provider),
  ].filter(Boolean);

  return (
    <main className="page-container standalone-page detail-page">
      <button type="button" className="back-button" onClick={onBack}>
        <ArrowLeft size={16} /> Back
      </button>

      <article className="detail-hero">
        <aside className="detail-sidebar">
          <DetailCover
            title={source.title}
            coverURL={source.coverUrl}
            icon={TypeIcon}
          />

          {localItem
            ? (
              <LibraryPanel
                item={localItem}
                actionLabel={selection.kind === "local"
                  ? "Manage title"
                  : "Manage in Library"}
                onManage={onManage}
              />
            )
            : selection.kind === "external"
            ? (
              <section className="detail-add-panel" aria-labelledby="add-title">
                <span className="eyebrow">START TRACKING</span>
                <h2 id="add-title">Add to your Library</h2>
                <p>
                  Track your status, progress, personal rating, and notes for
                  this title.
                </p>
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => onAdd(selection.result)}
                >
                  <CirclePlus size={16} /> Add to Library
                </button>
              </section>
            )
            : null}

          {selection.kind === "local" && media && (
            <button
              type="button"
              className="detail-remove-button"
              onClick={() => onDelete(media)}
            >
              <Trash2 size={15} /> Remove from Library
            </button>
          )}
        </aside>

        <div className="detail-content">
          <header className="detail-title-block">
            <span className="eyebrow">
              {selection.kind === "local" ? "IN YOUR LIBRARY" : "CATALOG TITLE"}
            </span>
            <h1>{source.title}</h1>
            {source.originalTitle && source.originalTitle !== source.title && (
              <p className="detail-original">{source.originalTitle}</p>
            )}
          </header>

          <section
            className="detail-catalog"
            aria-labelledby="catalog-data-title"
          >
            <div className="detail-section-heading">
              <div>
                <span className="eyebrow">CATALOG INFORMATION</span>
                <h2 id="catalog-data-title">About this title</h2>
              </div>
              {source.communityRating
                ? (
                  <span className="detail-community-rating">
                    <Star size={14} fill="currentColor" />
                    {source.communityRating.toFixed(1)}/10 community
                  </span>
                )
                : null}
            </div>
            <div className="detail-meta" aria-label="Catalog facts">
              {catalogFacts.map((fact, index) => (
                <span key={`${fact}-${index}`}>{fact}</span>
              ))}
            </div>
            {(genres.length > 0 || credits.length > 0) && (
              <div className="detail-metadata-groups">
                {genres.length > 0 && (
                  <section aria-labelledby="detail-genres-title">
                    <h3 id="detail-genres-title">
                      {source.type === "book" ? "Genres & subjects" : "Genres"}
                    </h3>
                    <ul className="detail-genres">
                      {genres.map((genre) => <li key={genre}>{genre}</li>)}
                    </ul>
                  </section>
                )}
                {credits.length > 0 && (
                  <section aria-labelledby="detail-credits-title">
                    <h3 id="detail-credits-title">Credits</h3>
                    <dl className="detail-credits">
                      {credits.map((credit, index) => (
                        <div key={`${credit.name}-${credit.role}-${index}`}>
                          <dt>{credit.name}</dt>
                          <dd>{credit.role}</dd>
                        </div>
                      ))}
                    </dl>
                  </section>
                )}
              </div>
            )}
            <p
              className={`detail-description ${
                source.description ? "" : "empty"
              }`}
            >
              {source.description ||
                (source.provider
                  ? "No synopsis is available from this provider."
                  : "No synopsis is available for this title.")}
            </p>
            {(providerURL || localMedia?.provider) && (
              <div className="detail-provider-actions">
                {providerURL && (
                  <a
                    className="detail-provider-link"
                    href={providerURL}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    View on {providerLabel(source.provider)}{" "}
                    <ExternalLink size={14} />
                  </a>
                )}
                {localMedia?.provider && (
                  <button
                    type="button"
                    className="detail-refresh-button"
                    onClick={() => onRefreshMetadata(localMedia)}
                    disabled={metadataRefreshing}
                  >
                    <RefreshCw
                      size={14}
                      className={metadataRefreshing ? "spinning" : ""}
                    />
                    {metadataRefreshing ? "Refreshing…" : "Refresh metadata"}
                  </button>
                )}
              </div>
            )}
            {selection.kind === "local" && metadataError && (
              <p className="detail-metadata-error" role="status">
                {metadataError}
              </p>
            )}
          </section>
        </div>
      </article>
    </main>
  );
}
