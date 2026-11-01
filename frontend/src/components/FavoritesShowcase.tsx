import type { FavoriteCandidate } from "../favoritesModel.ts";
import type { TrackingMediaType } from "../mediaTracking.ts";
import { FavoriteCover } from "./FavoriteCover.tsx";
import { FavoritesExport } from "./FavoritesExport.tsx";

interface FavoritesShowcaseProps {
  items: FavoriteCandidate[];
  onOpen: (id: number) => void;
  mediaType: TrackingMediaType;
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
  { items, onOpen, mediaType, label }: FavoritesShowcaseProps,
) {
  if (items.length === 0) return null;

  return (
    <section className="favorites-showcase" aria-label={`${label} favorites`}>
      <header>
        <h3>{label}</h3>
        <span>{items.length} of 9</span>
      </header>
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
      <FavoritesExport items={items} mediaType={mediaType} label={label} />
    </section>
  );
}
