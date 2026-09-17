import { useEffect, useRef, useState } from "react";
import {
  BookOpen,
  CirclePlus,
  Clapperboard,
  ExternalLink,
  Film,
  Gamepad2,
  Library,
  type LucideIcon,
  Pencil,
  RefreshCw,
  Sparkles,
  Star,
  Tv,
} from "lucide-react";
import {
  catalogCoverStyle,
  type CatalogRelation,
  type SearchCatalogResult,
  type SearchMediaCredit,
  type SearchMediaType,
} from "./GlobalSearchBox.tsx";
import {
  catalogTotalLabel,
  mediaStatusLabel,
  type TrackingMediaStatus,
} from "../mediaTracking.ts";

export type DetailMediaStatus = TrackingMediaStatus;

export interface DetailLibraryMedia {
  id: number;
  title: string;
  type: SearchMediaType;
  status: DetailMediaStatus;
  progress: number;
  total: number;
  rating: number;
  repeatCount: number;
  playtimeMinutes: number;
  playedOnPlatforms: string[];
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
  catalogPlatforms: string[];
  createdAt: string;
  updatedAt: string;
}

type DetailSelection =
  | { kind: "local"; mediaId: number }
  | { kind: "external"; result: SearchCatalogResult };

interface DetailCatalogRelation extends CatalogRelation {
  existing?: DetailLibraryMedia;
}

interface MediaDetailPageProps {
  selection: DetailSelection | null;
  loading: boolean;
  media?: DetailLibraryMedia;
  existing?: DetailLibraryMedia;
  metadataRefreshing: boolean;
  metadataError: string;
  alternativeTitles: string[];
  relations: DetailCatalogRelation[];
  catalogContextLoading: boolean;
  catalogContextError: string;
  onBack: () => void;
  onAdd: (result: SearchCatalogResult) => void;
  onRefreshMetadata: (item: DetailLibraryMedia) => void;
  onRetryCatalogContext: () => void;
  onOpenRelated: (result: SearchCatalogResult) => void;
  onManage: (item: DetailLibraryMedia) => void;
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
  game: { label: "Game", icon: Gamepad2 },
};

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
  const labels: Record<string, string> = {
    anilist: "AniList",
    kitsu: "Kitsu",
    open_library: "Open Library",
    rawg: "RAWG",
    tmdb: "TMDB",
  };
  return labels[provider] || "Local entry";
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

function ExpandableDescription(
  { description, provider }: { description?: string; provider?: string },
) {
  const text = description ||
    (provider
      ? "No synopsis is available from this provider."
      : "No synopsis is available for this title.");
  const [expanded, setExpanded] = useState(false);
  const canExpand = Boolean(description && description.length > 360);

  return (
    <>
      <p
        className={`detail-description ${description ? "" : "empty"} ${
          canExpand && !expanded ? "collapsed" : ""
        }`}
      >
        {text}
      </p>
      {canExpand && (
        <button
          type="button"
          className="detail-provider-link detail-description-toggle"
          aria-expanded={expanded}
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded ? "Read less" : "Read more"}
        </button>
      )}
    </>
  );
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
      <button
        type="button"
        className={`detail-manage-button ${item.status}`}
        aria-label={`${actionLabel}, current status: ${
          mediaStatusLabel(item.status, item.type)
        }`}
        onClick={() => onManage(item)}
      >
        <Pencil size={16} />
        <span>{mediaStatusLabel(item.status, item.type)}</span>
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
    alternativeTitles,
    relations,
    catalogContextLoading,
    catalogContextError,
    onBack,
    onAdd,
    onRefreshMetadata,
    onRetryCatalogContext,
    onOpenRelated,
    onManage,
  }: MediaDetailPageProps,
) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  const focusIdentity = selection?.kind === "local"
    ? `local:${selection.mediaId}`
    : selection?.kind === "external"
    ? `external:${selection.result.provider}:${selection.result.providerId}`
    : "";
  useEffect(() => {
    if (!loading && focusIdentity) titleRef.current?.focus();
  }, [focusIdentity, loading, media?.id]);

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
  const catalogPlatforms = Array.isArray(source.catalogPlatforms)
    ? source.catalogPlatforms.filter((platform): platform is string =>
      typeof platform === "string"
    ).slice(0, 12)
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
    { label: "Type", value: type.label },
    {
      label: "Format",
      value: source.type === "game" ? "" : source.format,
    },
    {
      label: "Release status",
      value: releaseStatusLabels[source.releaseStatus || ""] || "",
    },
    {
      label: "Release",
      value: releasePeriod ||
        (source.releaseYear ? String(source.releaseYear) : ""),
    },
    {
      label: "Length",
      value: catalogTotal > 0
        ? catalogTotalLabel(source.type, catalogTotal)
        : "",
    },
    {
      label: "Duration",
      value: durationLabel(source.type, source.durationMinutes || 0),
    },
    { label: "Source", value: providerLabel(source.provider) },
  ].filter((fact) => fact.value);

  return (
    <main className="page-container standalone-page detail-page">
      <article className="detail-layout">
        <header className="detail-title-block">
          <h1 ref={titleRef} tabIndex={-1}>{source.title}</h1>
          {alternativeTitles.length > 0
            ? (
              <div className="detail-alternative-titles">
                <h2>Alternative titles</h2>
                <p>{alternativeTitles.join(" · ")}</p>
              </div>
            )
            : source.originalTitle && source.originalTitle !== source.title
            ? <p className="detail-original">{source.originalTitle}</p>
            : null}
          {source.communityRating
            ? (
              <span className="detail-community-rating">
                <Star size={14} fill="currentColor" />
                {source.communityRating.toFixed(1)}/10 community
              </span>
            )
            : null}
        </header>

        <div className="detail-cover-column">
          <DetailCover
            title={source.title}
            coverURL={source.coverUrl}
            icon={TypeIcon}
          />
          <aside className="detail-record-rail">
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
                <section
                  className="detail-add-panel"
                  aria-label="Add to Library"
                >
                  <button
                    type="button"
                    className="primary-button"
                    onClick={() => onAdd(selection.result)}
                    disabled={catalogContextLoading}
                  >
                    <CirclePlus size={16} />
                    {catalogContextLoading
                      ? "Loading details…"
                      : "Add to Library"}
                  </button>
                </section>
              )
              : null}
          </aside>
          <section
            className="detail-catalog"
            aria-labelledby="catalog-data-title"
          >
            <div className="detail-section-heading">
              <h2 id="catalog-data-title">Catalog details</h2>
            </div>
            <dl className="detail-facts" aria-label="Catalog facts">
              {catalogFacts.map((fact) => (
                <div key={fact.label}>
                  <dt>{fact.label}</dt>
                  <dd>{fact.value}</dd>
                </div>
              ))}
            </dl>
          </section>
        </div>

        <section className="detail-overview" aria-label="Synopsis">
          <ExpandableDescription
            key={`${focusIdentity}:${source.description || ""}`}
            description={source.description}
            provider={source.provider}
          />
          {(genres.length > 0 || providerURL || localMedia?.provider) && (
            <div className="detail-overview-footer">
              {genres.length > 0 && (
                <section
                  className="detail-genres-section"
                  aria-labelledby="detail-genres-title"
                >
                  <h2 id="detail-genres-title">
                    {source.type === "book" ? "Genres & subjects" : "Genres"}
                  </h2>
                  <ul className="detail-genres">
                    {genres.map((genre) => <li key={genre}>{genre}</li>)}
                  </ul>
                </section>
              )}
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
            </div>
          )}
        </section>

        {(relations.length > 0 || catalogContextLoading ||
          catalogContextError) && (
          <section className="detail-related" aria-labelledby="related-title">
            <div className="detail-section-heading">
              <h2 id="related-title">Related media</h2>
            </div>
            {catalogContextLoading && relations.length === 0 && (
              <p className="detail-metadata-status" role="status">
                Loading related media…
              </p>
            )}
            {catalogContextError && (
              <div className="detail-related-error" role="status">
                <span>Related media could not be loaded.</span>
                <button type="button" onClick={onRetryCatalogContext}>
                  <RefreshCw size={13} /> Try again
                </button>
              </div>
            )}
            {relations.length > 0 && (
              <div className="detail-related-grid">
                {relations.map((
                  { relation, result, existing: relatedItem },
                ) => (
                  <button
                    type="button"
                    className="detail-related-item"
                    aria-label={`Open ${result.title}, ${relation}${
                      relatedItem ? ", in your Library" : ""
                    }`}
                    onClick={() => onOpenRelated(result)}
                    key={`${result.provider}:${result.type}:${result.providerId}`}
                  >
                    <span
                      className="detail-related-cover"
                      style={catalogCoverStyle(result.coverUrl)}
                      aria-hidden="true"
                    />
                    <span className="detail-related-copy">
                      <small>{relation}</small>
                      <strong>{result.title}</strong>
                      <em>
                        {typeDetails[result.type]?.label || "Media"}
                        {result.releaseYear ? ` · ${result.releaseYear}` : ""}
                        {relatedItem ? " · In Library" : ""}
                      </em>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </section>
        )}

        {(credits.length > 0 || catalogPlatforms.length > 0 ||
          (selection.kind === "external" && metadataRefreshing) ||
          metadataError) && (
          <section
            className="detail-supporting-metadata"
            aria-label="More details"
          >
            {(credits.length > 0 || catalogPlatforms.length > 0) && (
              <div className="detail-metadata-groups">
                {catalogPlatforms.length > 0 && (
                  <section aria-labelledby="detail-platforms-title">
                    <h2 id="detail-platforms-title">Available on</h2>
                    <ul className="detail-genres">
                      {catalogPlatforms.map((platform) => (
                        <li key={platform}>{platform}</li>
                      ))}
                    </ul>
                  </section>
                )}
                {credits.length > 0 && (
                  <section
                    className="detail-credits-group"
                    aria-labelledby="detail-credits-title"
                  >
                    <h2 id="detail-credits-title">Credits</h2>
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
            {selection.kind === "external" && metadataRefreshing && (
              <p className="detail-metadata-status" role="status">
                Loading full catalog details…
              </p>
            )}
            {metadataError && (
              <p className="detail-metadata-error" role="status">
                {selection.kind === "external"
                  ? `Some catalog details could not be loaded. ${metadataError}`
                  : metadataError}
              </p>
            )}
          </section>
        )}
      </article>
    </main>
  );
}
