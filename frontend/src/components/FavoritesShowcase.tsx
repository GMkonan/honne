import { Heart } from "lucide-react";
import type { FavoriteCandidate } from "./FavoritesSettingsCard.tsx";

interface FavoritesShowcaseProps {
  items: FavoriteCandidate[];
  onOpen: (id: number) => void;
}

export function FavoritesShowcase({ items, onOpen }: FavoritesShowcaseProps) {
  if (items.length === 0) return null;

  return (
    <section className="favorites-showcase" aria-labelledby="favorites-title">
      <header>
        <div>
          <span className="eyebrow">HANDPICKED</span>
          <h2 id="favorites-title">
            <Heart size={16} fill="currentColor" /> Favorites
          </h2>
        </div>
        <span>{items.length} of 9</span>
      </header>
      <div className="favorites-grid">
        {items.map((item, index) => (
          <button
            type="button"
            className={item.coverUrl ? "" : "favorite-fallback"}
            style={item.coverUrl
              ? {
                backgroundImage: `url("${item.coverUrl.replaceAll('"', "")}")`,
              }
              : undefined}
            onClick={() => onOpen(item.id)}
            aria-label={`Open favorite ${index + 1}: ${item.title}`}
            key={item.id}
          >
            <span className="favorite-rank">
              {String(index + 1).padStart(2, "0")}
            </span>
            <span className="favorite-title">{item.title}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
