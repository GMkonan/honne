import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { Grid3X3, Heart, Pencil } from "lucide-react";
import { type FavoriteCandidate, favoriteTypes } from "../favoritesModel.ts";
import type { TrackingMediaType } from "../mediaTracking.ts";
import { loadTopNine, saveTopNine } from "../services/topNine.ts";
import { FavoritesPickerModal } from "./FavoritesPickerModal.tsx";
import { FavoritesShowcase } from "./FavoritesShowcase.tsx";

interface FavoritesPanelProps {
  items: FavoriteCandidate[];
  favoriteMediaIds: number[];
  loading: boolean;
  error: string;
  onRetry: () => void;
  onSave: (mediaIds: number[], signal: AbortSignal) => Promise<void>;
  onOpen: (id: number) => void;
}

export function FavoritesPanel(
  { items, favoriteMediaIds, loading, error, onRetry, onSave, onOpen }:
    FavoritesPanelProps,
) {
  const [editing, setEditing] = useState<"favorites" | "top_nine" | null>(null);
  const [chosenType, setChosenType] = useState<TrackingMediaType | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [topNineIds, setTopNineIds] = useState<number[]>([]);
  const [topNineLoading, setTopNineLoading] = useState(false);
  const [topNineError, setTopNineError] = useState("");
  const topNineRequest = useRef<AbortController | null>(null);
  const byId = new Map(items.map((item) => [item.id, item]));
  const favorites = favoriteMediaIds.flatMap((id) => {
    const item = byId.get(id);
    return item ? [item] : [];
  });
  const activeType = chosenType ||
    favoriteTypes.find(({ value }) =>
      favorites.some((item) => item.type === value)
    )?.value ||
    favoriteTypes.find(({ value }) => items.some((item) => item.type === value))
      ?.value ||
    "anime";
  const categoryLabel =
    favoriteTypes.find(({ value }) => value === activeType)?.label || "Anime";
  const group = favorites.filter((item) => item.type === activeType);

  useEffect(() => () => topNineRequest.current?.abort(), []);

  function selectType(value: TrackingMediaType) {
    setChosenType(value);
    setExpanded(false);
  }

  function handleTabKey(
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) {
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % favoriteTypes.length;
    else if (event.key === "ArrowLeft") {
      next = (index + favoriteTypes.length - 1) % favoriteTypes.length;
    } else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = favoriteTypes.length - 1;
    else return;
    event.preventDefault();
    selectType(favoriteTypes[next].value);
    document.getElementById(`favorites-tab-${favoriteTypes[next].value}`)
      ?.focus();
  }

  async function openTopNine() {
    if (topNineRequest.current) return;
    const controller = new AbortController();
    topNineRequest.current = controller;
    setTopNineLoading(true);
    setTopNineError("");
    try {
      const ids = await loadTopNine(controller.signal);
      if (!controller.signal.aborted) {
        setTopNineIds(ids);
        setEditing("top_nine");
      }
    } catch (caught: unknown) {
      if (!controller.signal.aborted) {
        setTopNineError(
          caught instanceof Error
            ? caught.message
            : "Could not open your 3×3. Please try again.",
        );
      }
    } finally {
      if (!controller.signal.aborted) {
        setTopNineLoading(false);
        topNineRequest.current = null;
      }
    }
  }

  async function handleSaveTopNine(ids: number[], signal: AbortSignal) {
    const saved = await saveTopNine(ids, signal);
    if (!signal.aborted) setTopNineIds(saved);
  }

  return (
    <aside
      className="library-favorites"
      id="library-favorites"
      aria-labelledby="library-favorites-title"
      aria-busy={loading}
    >
      <header className="favorites-panel-heading">
        <h2 id="library-favorites-title">
          <Heart size={18} aria-hidden="true" /> Favorites
        </h2>
      </header>
      {loading && (
        <p role="status">
          {favorites.length ? "Refreshing favorites…" : "Loading favorites…"}
        </p>
      )}
      {error && (
        <div className="favorites-load-error">
          <p role="alert">{error}</p>
          <button type="button" onClick={onRetry} disabled={loading}>
            Retry favorites
          </button>
        </div>
      )}
      {((!loading && !error) || favorites.length > 0) && (
        <>
          <div
            className="favorites-category-tabs"
            role="tablist"
            aria-label="Favorite categories"
          >
            {favoriteTypes.map(({ value, label }, index) => (
              <button
                type="button"
                role="tab"
                id={`favorites-tab-${value}`}
                key={value}
                aria-selected={activeType === value}
                aria-controls={`favorites-panel-${value}`}
                tabIndex={activeType === value ? 0 : -1}
                onClick={() => selectType(value)}
                onKeyDown={(event) => handleTabKey(event, index)}
              >
                {label}
              </button>
            ))}
          </div>
          <div
            role="tabpanel"
            id={`favorites-panel-${activeType}`}
            aria-labelledby={`favorites-tab-${activeType}`}
            tabIndex={0}
          >
            <p className="favorites-category-count">
              {group.length} {group.length === 1 ? "favorite" : "favorites"}
            </p>
            {group.length > 0
              ? (
                <FavoritesShowcase
                  label={categoryLabel}
                  items={expanded ? group : group.slice(0, 8)}
                  onOpen={onOpen}
                />
              )
              : (
                <p className="favorites-empty">
                  {favorites.length
                    ? `No ${categoryLabel.toLocaleLowerCase()} favorites yet.`
                    : "Choose the titles you love from your Library to get started."}
                </p>
              )}
            {group.length > 8 && (
              <button
                type="button"
                className="favorites-show-more"
                aria-expanded={expanded}
                onClick={() => setExpanded((current) => !current)}
              >
                {expanded ? "Show less" : `Show more (${group.length - 8})`}
              </button>
            )}
          </div>
          <div className="favorites-panel-actions">
            <button
              type="button"
              disabled={loading || !!error || !!editing || topNineLoading}
              onClick={() => setEditing("favorites")}
              aria-haspopup="dialog"
            >
              <Pencil size={14} aria-hidden="true" />{" "}
              {favorites.length ? "Edit favorites" : "Choose favorites"}
            </button>
            <button
              type="button"
              disabled={loading || !!error || !!editing || topNineLoading ||
                favorites.length === 0}
              onClick={() => void openTopNine()}
              aria-haspopup="dialog"
            >
              <Grid3X3 size={14} aria-hidden="true" />Build 3×3
            </button>
          </div>
        </>
      )}
      {topNineLoading && <p role="status">Loading your 3×3…</p>}
      {topNineError && (
        <div className="favorites-load-error">
          <p role="alert">{topNineError}</p>
          <button
            type="button"
            disabled={topNineLoading}
            onClick={() => void openTopNine()}
          >
            Retry 3×3
          </button>
        </div>
      )}
      {editing && !loading && !error && (
        <FavoritesPickerModal
          mode={editing}
          initialType={activeType}
          items={editing === "top_nine" ? favorites : items}
          favoriteMediaIds={editing === "top_nine"
            ? topNineIds
            : favoriteMediaIds}
          onSave={editing === "top_nine" ? handleSaveTopNine : onSave}
          onClose={() => setEditing(null)}
        />
      )}
    </aside>
  );
}
