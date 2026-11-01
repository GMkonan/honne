import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import {
  type FavoriteCandidate,
  favoritesPerType,
  favoriteTypes,
} from "../favoritesModel.ts";

interface FavoritesEditorProps {
  items: FavoriteCandidate[];
  favoriteMediaIds: number[];
  onSave: (mediaIds: number[], signal: AbortSignal) => Promise<void>;
  onClose: () => void;
}

export function FavoritesEditor({
  items,
  favoriteMediaIds,
  onSave,
  onClose,
}: FavoritesEditorProps) {
  const [draft, setDraft] = useState(favoriteMediaIds);
  const [mediaType, setMediaType] = useState("anime");
  const [selection, setSelection] = useState("");
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");
  const typeRef = useRef<HTMLSelectElement>(null);
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
    typeRef.current?.focus();
    return () => {
      activeSave.current?.abort();
      if (trigger instanceof HTMLElement && trigger.isConnected) {
        trigger.focus();
      }
    };
  }, []);

  const byId = new Map(items.map((item) => [item.id, item]));
  const selected = draft.filter((id) => byId.get(id)?.type === mediaType);
  const available = items.filter((item) =>
    item.type === mediaType && !draft.includes(item.id)
  ).sort((left, right) => left.title.localeCompare(right.title));
  const changed = draft.length !== favoriteMediaIds.length ||
    draft.some((id, index) => id !== favoriteMediaIds[index]);

  function handleAdd() {
    const id = Number(selection);
    if (
      saving || selected.length >= favoritesPerType ||
      !available.some((item) => item.id === id)
    ) return;
    setDraft((current) => [...current, id]);
    setSelection("");
    setFeedback("");
    setError("");
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
        setFeedback("Favorites saved in this order.");
      }
    } catch (caught: unknown) {
      if (!controller.signal.aborted) {
        setError(
          caught instanceof Error
            ? caught.message
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
    <section
      className="favorites-editor"
      aria-labelledby="favorites-editor-title"
    >
      <h3 id="favorites-editor-title">Edit favorites</h3>
      <p>Choose and order up to nine titles in each category.</p>
      <label className="favorite-type-picker">
        <span>Favorite media type</span>
        <select
          ref={typeRef}
          value={mediaType}
          disabled={saving}
          onChange={(event) => {
            setMediaType(event.target.value);
            setSelection("");
          }}
        >
          {favoriteTypes.map(({ value, label }) => (
            <option value={value} key={value}>{label}</option>
          ))}
        </select>
      </label>
      <p>{selected.length} / {favoritesPerType} in this category</p>
      <div className="favorite-picker">
        <label>
          <span className="sr-only">Title to add to favorites</span>
          <select
            value={selection}
            onChange={(event) => setSelection(event.target.value)}
            disabled={saving || selected.length >= favoritesPerType ||
              available.length === 0}
          >
            <option value="">Choose a Library title…</option>
            {available.map((item) => (
              <option value={item.id} key={item.id}>{item.title}</option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={handleAdd}
          disabled={saving || !selection || selected.length >= favoritesPerType}
        >
          <Plus size={14} aria-hidden="true" /> Add
        </button>
      </div>
      {selected.length === 0
        ? <p>No favorites in this category yet.</p>
        : (
          <ol className="favorite-order-list" aria-label="Favorite order">
            {selected.map((id, index) => {
              const item = byId.get(id);
              if (!item) return null;
              return (
                <li key={id}>
                  <span className="favorite-order-copy">
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
                        setDraft((current) =>
                          current.filter((entry) => entry !== id)
                        );
                        setFeedback("");
                        setError("");
                        typeRef.current?.focus();
                      }}
                      aria-label={`Remove ${item.title} from favorites`}
                    >
                      <X size={14} />
                    </button>
                  </span>
                </li>
              );
            })}
          </ol>
        )}
      <div className="favorites-editor-actions">
        <button
          type="button"
          className="primary-button"
          onClick={() => void handleSave()}
          disabled={!changed || saving}
        >
          {saving ? "Saving…" : "Save favorites"}
        </button>
        <button type="button" disabled={saving} onClick={onClose}>
          {changed ? "Cancel changes" : "Done editing"}
        </button>
      </div>
      {(saving || feedback) && (
        <p role="status">{saving ? "Saving favorites…" : feedback}</p>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
