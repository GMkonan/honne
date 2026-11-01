import { Heart, Pencil } from "lucide-react";
import { useState } from "react";
import { type FavoriteCandidate, favoriteTypes } from "../favoritesModel.ts";
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
  const [editing, setEditing] = useState(false);
  const byId = new Map(items.map((item) => [item.id, item]));
  const favorites = favoriteMediaIds.flatMap((id) => {
    const item = byId.get(id);
    return item ? [item] : [];
  });

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
        <button
          type="button"
          disabled={loading || !!error || editing}
          onClick={() => setEditing(true)}
          aria-haspopup="dialog"
        >
          <Pencil size={14} aria-hidden="true" />{" "}
          {favorites.length ? "Edit favorites" : "Choose favorites"}
        </button>
      </header>
      <p className="favorites-panel-note">
        Handpicked from your Library. Up to nine per media type.
      </p>
      {loading && <p role="status">Loading favorites…</p>}
      {error && (
        <div className="favorites-load-error">
          <p role="alert">{error}</p>
          <button type="button" onClick={onRetry} disabled={loading}>
            Retry favorites
          </button>
        </div>
      )}
      {editing && !loading && !error && (
        <FavoritesPickerModal
          items={items}
          favoriteMediaIds={favoriteMediaIds}
          onSave={onSave}
          onClose={() => setEditing(false)}
        />
      )}
      {!editing && favorites.length === 0 && !loading && !error && (
        <p className="favorites-empty">
          Keep the titles you love alongside your collection. Choose favorites
          to get started.
        </p>
      )}
      {favoriteTypes.map(({ value, label }) => {
        const group = favorites.filter((item) => item.type === value);
        return group.length > 0
          ? (
            <FavoritesShowcase
              key={value}
              mediaType={value}
              label={label}
              items={group}
              onOpen={onOpen}
            />
          )
          : null;
      })}
    </aside>
  );
}
