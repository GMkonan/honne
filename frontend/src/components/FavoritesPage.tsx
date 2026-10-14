import { Heart } from "lucide-react";
import type { FavoriteCandidate } from "./FavoritesSettingsCard.tsx";
import { FavoritesShowcase } from "./FavoritesShowcase.tsx";
import { LibrarySectionNav } from "./LibrarySectionNav.tsx";

interface FavoritesPageProps {
  items: FavoriteCandidate[];
  onOpen: (id: number) => void;
}

export function FavoritesPage({ items, onOpen }: FavoritesPageProps) {
  return (
    <main className="page-container standalone-page favorites-page">
      <LibrarySectionNav active="favorites" />
      {items.length > 0
        ? <FavoritesShowcase items={items} onOpen={onOpen} />
        : (
          <section
            className="favorites-empty"
            aria-labelledby="favorites-empty-title"
          >
            <Heart size={28} aria-hidden="true" />
            <div>
              <h2 id="favorites-empty-title">Your 3×3 is waiting</h2>
              <p>
                Pick up to nine titles from your Library and arrange them in the
                order that feels right.
              </p>
            </div>
            <a className="primary-button" href="#settings">
              Choose favorites
            </a>
          </section>
        )}
    </main>
  );
}
