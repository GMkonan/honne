import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Check, Search, X } from "lucide-react";
import { FavoriteCover } from "./FavoriteCover.tsx";
import { FavoritesExport } from "./FavoritesExport.tsx";
import type { TrackingMediaType } from "../mediaTracking.ts";
import {
  type FavoriteCandidate,
  favoriteTypes,
  topNinePerType,
} from "../favoritesModel.ts";

interface FavoritesPickerModalProps {
  items: FavoriteCandidate[];
  favoriteMediaIds: number[];
  onSave: (mediaIds: number[], signal: AbortSignal) => Promise<void>;
  onClose: () => void;
  mode?: "favorites" | "top_nine";
  initialType?: TrackingMediaType;
}

export function FavoritesPickerModal({
  items,
  favoriteMediaIds,
  onSave,
  onClose,
  mode = "favorites",
  initialType,
}: FavoritesPickerModalProps) {
  const topNine = mode === "top_nine";
  const [draft, setDraft] = useState(favoriteMediaIds);
  const [mediaType, setMediaType] = useState(() =>
    initialType || favoriteTypes.find((type) =>
      items.some((item) => item.type === type.value)
    )
      ?.value ||
    "anime"
  );
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const activeSave = useRef<AbortController | null>(null);
  const previousSavedIds = useRef(favoriteMediaIds);

  useEffect(() => {
    const removed = new Set(
      previousSavedIds.current.filter((id) => !favoriteMediaIds.includes(id)),
    );
    previousSavedIds.current = favoriteMediaIds;
    if (removed.size > 0) {
      setDraft((current) => current.filter((id) => !removed.has(id)));
    }
  }, [favoriteMediaIds]);

  useEffect(() => {
    const trigger = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    searchRef.current?.focus();
    return () => {
      activeSave.current?.abort();
      document.body.style.overflow = previousOverflow;
      if (trigger instanceof HTMLElement && trigger.isConnected) {
        trigger.focus();
      }
    };
  }, []);

  useEffect(() => {
    if (saving) dialogRef.current?.focus();
  }, [saving]);

  useEffect(() => {
    const available = new Set(items.map((item) => item.id));
    setDraft((current) => current.filter((id) => available.has(id)));
  }, [items]);

  const byId = new Map(items.map((item) => [item.id, item]));
  const selected = draft.filter((id) => byId.get(id)?.type === mediaType);
  const categoryItems = items.filter((item) => item.type === mediaType);
  const matches = categoryItems.filter((item) =>
    item.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
  ).sort((left, right) => left.title.localeCompare(right.title));
  const categoryLabel =
    favoriteTypes.find((type) => type.value === mediaType)?.label || "Anime";
  const full = topNine && selected.length >= topNinePerType;
  const changed = draft.length !== favoriteMediaIds.length ||
    draft.some((id, index) => id !== favoriteMediaIds[index]);

  function handleToggle(id: number) {
    if (saving || !categoryItems.some((item) => item.id === id)) return;
    const exists = draft.includes(id);
    if (!exists && full) return;
    setDraft((current) =>
      exists ? current.filter((entry) => entry !== id) : [...current, id]
    );
    setFeedback("");
    setError("");
  }

  function handleDialogKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      if (!saving) onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(
        "button:not([disabled]), input:not([disabled]), a[href]",
      ) || [],
    );
    if (focusable.length === 0) {
      event.preventDefault();
      dialogRef.current?.focus();
      return;
    }
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

  function handleMove(index: number, direction: -1 | 1) {
    const destination = index + direction;
    if (saving || destination < 0 || destination >= selected.length) return;
    const sourceIndex = draft.indexOf(selected[index]);
    const targetIndex = draft.indexOf(selected[destination]);
    const next = [...draft];
    [next[sourceIndex], next[targetIndex]] = [
      next[targetIndex],
      next[sourceIndex],
    ];
    setDraft(next);
    setFeedback("");
    setError("");
  }

  async function handleSave() {
    if (!changed || activeSave.current) return;
    const controller = new AbortController();
    activeSave.current = controller;
    setSaving(true);
    setError("");
    setFeedback("");
    try {
      await onSave(draft, controller.signal);
      if (!controller.signal.aborted) {
        setFeedback(
          topNine
            ? "3×3 selection saved in this order."
            : "Favorites saved in this order.",
        );
      }
    } catch (caught: unknown) {
      if (!controller.signal.aborted) {
        setError(
          caught instanceof Error
            ? caught.message
            : topNine
            ? "Could not save 3×3 selection."
            : "Could not save favorites.",
        );
      }
    } finally {
      if (!controller.signal.aborted) {
        activeSave.current = null;
        setSaving(false);
      }
    }
  }

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (!saving && event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="modal favorites-picker-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="favorites-picker-title"
        aria-describedby="favorites-picker-description"
        aria-busy={saving}
        tabIndex={-1}
        onKeyDown={handleDialogKeyDown}
      >
        <header className="modal-header favorites-picker-header">
          <div>
            <h2 id="favorites-picker-title">
              {topNine ? "Build your 3×3" : "Choose your favorites"}
            </h2>
            <p id="favorites-picker-description">
              {topNine
                ? "Choose up to nine favorites per media type and set their order. This selection is separate from your favorites."
                : "Pick the titles you love, then save your selection. Favorites removed here also leave your 3×3."}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            aria-label={topNine
              ? "Close 3×3 builder"
              : "Close favorites picker"}
          >
            <X size={20} />
          </button>
        </header>
        <div className="favorites-picker-body">
          <section
            className="favorites-picker-browse"
            aria-label={topNine
              ? "Favorites to choose for 3×3"
              : "Library titles to choose"}
          >
            <label className="favorites-picker-search">
              <span className="sr-only">
                {topNine ? "Search favorite titles" : "Search Library titles"}
              </span>
              <span>
                <Search size={18} aria-hidden="true" />
                <input
                  ref={searchRef}
                  type="search"
                  value={query}
                  disabled={saving}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={topNine
                    ? "Search your favorites…"
                    : "Search your Library…"}
                />
              </span>
            </label>
            <div
              className="favorites-type-filters"
              role="group"
              aria-label="Favorite media type"
            >
              {favoriteTypes.map(({ value, label }) => (
                <button
                  type="button"
                  key={value}
                  aria-label={label}
                  aria-pressed={mediaType === value}
                  disabled={saving}
                  onClick={() => setMediaType(value)}
                >
                  {label}
                  <small aria-hidden="true">
                    {draft.filter((id) => byId.get(id)?.type === value)
                      .length}
                    {topNine ? "/9" : ""}
                  </small>
                </button>
              ))}
            </div>
            <p className="favorites-picker-results" role="status">
              {matches.length} {matches.length === 1 ? "title" : "titles"} ·
              {" "}
              {categoryLabel}
            </p>
            {matches.length > 0
              ? (
                <div
                  className="favorites-choice-grid"
                  aria-label={`${categoryLabel} choices`}
                >
                  {matches.map((item) => {
                    const position = selected.indexOf(item.id);
                    const picked = position !== -1;
                    return (
                      <button
                        type="button"
                        key={item.id}
                        className="favorite-choice"
                        aria-label={topNine
                          ? `Select ${item.title} for 3×3`
                          : `Favorite ${item.title}`}
                        aria-pressed={picked}
                        disabled={saving || (!picked && full)}
                        aria-describedby={full
                          ? "favorites-picker-limit"
                          : undefined}
                        onClick={() => handleToggle(item.id)}
                        title={item.title}
                      >
                        <span className="favorite-choice-art">
                          <FavoriteCover
                            title={item.title}
                            coverUrl={item.coverUrl}
                          />
                          {picked && (
                            <span className="favorite-choice-check">
                              <Check size={15} aria-hidden="true" />
                              {position + 1}
                            </span>
                          )}
                        </span>
                        <strong>{item.title}</strong>
                        <span className="favorite-choice-state">
                          {picked
                            ? "Selected"
                            : topNine
                            ? "Add to 3×3"
                            : "Add to favorites"}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )
              : (
                <div className="favorites-picker-empty">
                  <h3>
                    {items.length === 0
                      ? topNine ? "No favorites yet" : "Your Library is empty"
                      : categoryItems.length === 0
                      ? "No titles in this category"
                      : "No matching titles"}
                  </h3>
                  <p>
                    {items.length === 0
                      ? topNine
                        ? "Choose favorites before building your 3×3."
                        : "Add titles to your Library before choosing favorites."
                      : categoryItems.length === 0
                      ? "Choose another media type to browse your Library."
                      : "Try another title or media type. Your selection is still here."}
                  </p>
                  {query && (
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => {
                        setQuery("");
                        searchRef.current?.focus();
                      }}
                    >
                      Clear search
                    </button>
                  )}
                </div>
              )}
          </section>
          <section
            className="favorites-picker-selection"
            aria-labelledby="favorites-selection-title"
          >
            <h3 id="favorites-selection-title">Your selection</h3>
            <p>
              {categoryLabel} · {selected.length}
              {topNine ? ` / ${topNinePerType}` : ""} in this category
            </p>
            <p id="favorites-picker-limit" role="status">
              {full
                ? "This category is full. Remove a title before adding another."
                : "Click a cover to select or unselect it. Use the arrows to change its order."}
            </p>
            {selected.length === 0
              ? (
                <p>
                  {topNine
                    ? "No titles in this 3×3 yet."
                    : "No favorites in this category yet."}
                </p>
              )
              : (
                <ol className="favorite-order-list" aria-label="Favorite order">
                  {selected.map((id, index) => {
                    const item = byId.get(id);
                    if (!item) return null;
                    return (
                      <li key={id}>
                        <span className="favorite-selected-cover">
                          <FavoriteCover
                            title={item.title}
                            coverUrl={item.coverUrl}
                          />
                        </span>
                        <span className="favorite-order-copy">
                          <small>#{index + 1}</small>
                          <strong>{item.title}</strong>
                        </span>
                        <span className="favorite-order-actions">
                          <button
                            type="button"
                            onClick={() => handleMove(index, -1)}
                            disabled={saving || index === 0}
                            aria-label={`Move ${item.title} earlier`}
                          >
                            <ArrowUp size={14} />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleMove(index, 1)}
                            disabled={saving || index === selected.length - 1}
                            aria-label={`Move ${item.title} later`}
                          >
                            <ArrowDown size={14} />
                          </button>
                          <button
                            type="button"
                            disabled={saving}
                            onClick={() => {
                              handleToggle(id);
                              searchRef.current?.focus();
                            }}
                            aria-label={`Remove ${item.title} from ${
                              topNine ? "3×3" : "favorites"
                            }`}
                          >
                            <X size={14} />
                          </button>
                        </span>
                      </li>
                    );
                  })}
                </ol>
              )}
            {topNine && selected.length > 0 && (
              <FavoritesExport
                items={selected.flatMap((id) => {
                  const item = byId.get(id);
                  return item ? [item] : [];
                })}
                mediaType={mediaType}
                label={categoryLabel}
                disabled={changed || saving}
              />
            )}
            {topNine && changed && (
              <p>Save your selection before downloading the image.</p>
            )}
          </section>
        </div>
        <footer className="favorites-picker-footer">
          {(saving || feedback) && (
            <p role="status">
              {saving
                ? topNine ? "Saving 3×3…" : "Saving favorites…"
                : feedback}
            </p>
          )}
          {error && <p role="alert">{error}</p>}
          <div className="favorites-picker-actions">
            <p>Changes stay private and are saved only when you confirm.</p>
            <button type="button" disabled={saving} onClick={onClose}>
              {changed ? "Cancel changes" : "Done editing"}
            </button>
            <button
              type="button"
              className="primary-button"
              onClick={() => void handleSave()}
              disabled={!changed || saving}
            >
              {saving ? "Saving…" : topNine ? "Save 3×3" : "Save favorites"}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
