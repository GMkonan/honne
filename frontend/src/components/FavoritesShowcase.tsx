import type { FavoriteCandidate } from "../favoritesModel.ts";
import { FavoriteCover } from "./FavoriteCover.tsx";

interface FavoritesShowcaseProps {
  items: FavoriteCandidate[];
  onOpen: (id: number) => void;
  label: string;
}

function FavoriteTile({ item, index, onOpen }: {
  item: FavoriteCandidate;
  index: number;
  onOpen: (id: number) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(item.id)}
      aria-label={`Open favorite ${index + 1}: ${item.title}`}
      title={item.title}
    >
      <FavoriteCover title={item.title} coverUrl={item.coverUrl} />
      <span className="favorite-title">{item.title}</span>
    </button>
  );
}

export function FavoritesShowcase(
  { items, onOpen, label }: FavoritesShowcaseProps,
) {
  if (items.length === 0) return null;

  return (
    <section className="favorites-showcase" aria-label={`${label} favorites`}>
      <div className="favorites-grid">
        {items.map((item, index) => (
          <FavoriteTile
            key={item.id}
            item={item}
            index={index}
            onOpen={onOpen}
          />
        ))}
      </div>
    </section>
  );
}
