import { Download, Heart } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { FavoriteCandidate } from "./FavoritesSettingsCard.tsx";
import { FavoritesShowcase } from "./FavoritesShowcase.tsx";
import { LibrarySectionNav } from "./LibrarySectionNav.tsx";
import {
  createFavoritesImage,
  favoritesImageFilename,
} from "../services/favoritesImage.ts";

interface FavoritesPageProps {
  items: FavoriteCandidate[];
  onOpen: (id: number) => void;
}

export function FavoritesPage({ items, onOpen }: FavoritesPageProps) {
  const [working, setWorking] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");
  const activeExport = useRef<AbortController | null>(null);
  const identity = JSON.stringify(
    items.map(({ id, title, coverUrl }) => ({ id, title, coverUrl })),
  );

  useEffect(() => {
    setWorking(false);
    setFeedback("");
    setError("");
    return () => {
      activeExport.current?.abort();
      activeExport.current = null;
    };
  }, [identity]);

  async function handleDownload() {
    if (activeExport.current || items.length === 0) return;
    const controller = new AbortController();
    activeExport.current = controller;
    setWorking(true);
    setFeedback("");
    setError("");
    try {
      const { blob, missingCovers } = await createFavoritesImage(
        items,
        controller.signal,
      );
      if (controller.signal.aborted || activeExport.current !== controller) {
        return;
      }
      const url = URL.createObjectURL(blob);
      try {
        const link = document.createElement("a");
        link.href = url;
        link.download = favoritesImageFilename;
        link.click();
      } finally {
        globalThis.setTimeout(() => URL.revokeObjectURL(url), 0);
      }
      setFeedback(
        missingCovers > 0
          ? `Favorites downloaded. ${missingCovers} ${
            missingCovers === 1 ? "cover was" : "covers were"
          } unavailable; title placeholders were used.`
          : "Favorites downloaded.",
      );
    } catch (caught: unknown) {
      if (!controller.signal.aborted) {
        setError(
          caught instanceof Error
            ? caught.message
            : "Image export failed. Please try again.",
        );
      }
    } finally {
      if (activeExport.current === controller) {
        activeExport.current = null;
        setWorking(false);
      }
    }
  }

  return (
    <main className="page-container standalone-page favorites-page">
      <LibrarySectionNav active="favorites" />
      {items.length > 0 && (
        <section className="favorites-export" aria-label="Favorites export">
          <button
            type="button"
            className="primary-button"
            disabled={working}
            onClick={() =>
              void handleDownload()}
          >
            <Download size={16} aria-hidden="true" />
            {working ? "Creating…" : "Download PNG"}
          </button>
          <p>
            Created in your browser with favorite covers and titles only.
            Nothing is published.
          </p>
          <p
            role="status"
            className={!working && !feedback ? "sr-only" : undefined}
          >
            {working ? "Creating your favorites image…" : feedback}
          </p>
          {error && <p role="alert">{error}</p>}
        </section>
      )}
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
