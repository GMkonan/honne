import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Heart, Plus, X } from "lucide-react";

export interface FavoriteCandidate {
  id: number;
  title: string;
  coverUrl: string;
  type: string;
}

interface FavoritesSettingsCardProps {
  items: FavoriteCandidate[];
  favoriteMediaIds: number[];
  onSave: (mediaIds: number[]) => Promise<void>;
}

export function FavoritesSettingsCard({
  items,
  favoriteMediaIds,
  onSave,
}: FavoritesSettingsCardProps) {
  const [draft, setDraft] = useState(favoriteMediaIds);
  const [selection, setSelection] = useState("");
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");

  useEffect(() => setDraft(favoriteMediaIds), [favoriteMediaIds]);

  const byId = new Map(items.map((item) => [item.id, item]));
  const available = items.filter((item) => !draft.includes(item.id)).sort(
    (left, right) => left.title.localeCompare(right.title),
  );
  const changed = draft.length !== favoriteMediaIds.length ||
    draft.some((id, index) => id !== favoriteMediaIds[index]);

  function addSelected() {
    const id = Number(selection);
    if (!id || draft.length >= 9 || draft.includes(id) || !byId.has(id)) return;
    setDraft((current) => [...current, id]);
    setSelection("");
    setFeedback("");
    setError("");
  }

  function move(index: number, direction: -1 | 1) {
    const destination = index + direction;
    if (destination < 0 || destination >= draft.length) return;
    setDraft((current) => {
      const next = [...current];
      [next[index], next[destination]] = [next[destination], next[index]];
      return next;
    });
    setFeedback("");
  }

  async function save() {
    if (!changed || saving) return;
    setSaving(true);
    setError("");
    setFeedback("");
    try {
      await onSave(draft);
      setFeedback("Favorites saved in this order.");
    } catch (caught: unknown) {
      setError(
        caught instanceof Error ? caught.message : "Could not save favorites.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="settings-card favorites-settings-card">
      <div className="settings-card-icon">
        <Heart size={21} />
      </div>
      <div className="settings-card-copy">
        <div className="settings-card-title">
          <div>
            <h2>Favorites</h2>
            <p>Curate and order up to nine titles for your 3×3.</p>
          </div>
          <span className="connection-badge">{draft.length} / 9</span>
        </div>

        <div className="favorite-picker">
          <label>
            <span className="sr-only">Title to add to favorites</span>
            <select
              value={selection}
              onChange={(event) => setSelection(event.target.value)}
              disabled={draft.length >= 9 || available.length === 0}
            >
              <option value="">Choose a Library title…</option>
              {available.map((item) => (
                <option value={item.id} key={item.id}>{item.title}</option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={addSelected}
            disabled={!selection || draft.length >= 9}
          >
            <Plus size={14} /> Add
          </button>
        </div>

        {draft.length === 0
          ? (
            <p className="settings-note">
              No favorites yet. Choose any mix of media from your Library.
            </p>
          )
          : (
            <ol className="favorite-order-list">
              {draft.map((id, index) => {
                const item = byId.get(id);
                if (!item) return null;
                return (
                  <li key={id}>
                    <span
                      className="favorite-order-cover"
                      style={item.coverUrl
                        ? {
                          backgroundImage: `url("${
                            item.coverUrl.replaceAll('"', "")
                          }")`,
                        }
                        : undefined}
                    >
                      {!item.coverUrl && item.title.slice(0, 1)}
                    </span>
                    <span className="favorite-order-copy">
                      <strong>{item.title}</strong>
                      <small>{item.type.replace("_", " ")}</small>
                    </span>
                    <span className="favorite-order-actions">
                      <button
                        type="button"
                        onClick={() => move(index, -1)}
                        disabled={index === 0}
                        aria-label={`Move ${item.title} earlier`}
                      >
                        <ArrowUp size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={() => move(index, 1)}
                        disabled={index === draft.length - 1}
                        aria-label={`Move ${item.title} later`}
                      >
                        <ArrowDown size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setDraft((current) =>
                            current.filter((entry) => entry !== id)
                          )}
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

        <div className="settings-actions">
          <button
            type="button"
            className="primary-button"
            onClick={save}
            disabled={!changed || saving}
          >
            {saving ? "Saving…" : "Save favorites"}
          </button>
          {changed && (
            <button
              type="button"
              onClick={() => setDraft(favoriteMediaIds)}
              disabled={saving}
            >
              Discard changes
            </button>
          )}
        </div>
        {feedback && (
          <p className="settings-feedback" role="status" aria-live="polite">
            {feedback}
          </p>
        )}
        {error && (
          <p className="settings-feedback error" role="alert">{error}</p>
        )}
      </div>
    </section>
  );
}
