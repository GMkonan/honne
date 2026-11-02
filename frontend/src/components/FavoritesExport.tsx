import { Download } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { FavoriteCandidate } from "../favoritesModel.ts";
import type { TrackingMediaType } from "../mediaTracking.ts";
import {
  createFavoritesImage,
  favoritesImageFilename,
} from "../services/favoritesImage.ts";

interface FavoritesExportProps {
  items: FavoriteCandidate[];
  mediaType: TrackingMediaType;
  label: string;
  disabled?: boolean;
}

export function FavoritesExport(
  { items, mediaType, label, disabled = false }: FavoritesExportProps,
) {
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
  }, [identity, mediaType]);

  async function handleDownload() {
    if (disabled || activeExport.current || items.length === 0) return;
    const controller = new AbortController();
    activeExport.current = controller;
    setWorking(true);
    setFeedback("");
    setError("");
    try {
      const { blob, missingCovers } = await createFavoritesImage(
        items,
        controller.signal,
        label,
      );
      if (controller.signal.aborted || activeExport.current !== controller) {
        return;
      }
      const url = URL.createObjectURL(blob);
      try {
        const link = document.createElement("a");
        link.href = url;
        link.download = favoritesImageFilename(mediaType);
        link.click();
      } finally {
        globalThis.setTimeout(() => URL.revokeObjectURL(url), 0);
      }
      setFeedback(
        missingCovers > 0
          ? `3×3 downloaded. ${missingCovers} ${
            missingCovers === 1 ? "cover was" : "covers were"
          } unavailable; title placeholders were used.`
          : "3×3 downloaded.",
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

  if (items.length === 0) return null;

  return (
    <div className="favorites-export">
      <button
        type="button"
        aria-label={`Download ${label} 3×3 PNG`}
        disabled={working || disabled}
        onClick={() => void handleDownload()}
      >
        <Download size={16} aria-hidden="true" />
        {working ? "Creating…" : "Download PNG"}
      </button>
      <p
        role="status"
        className={!working && !feedback ? "sr-only" : undefined}
      >
        {working ? "Creating your 3×3 image…" : feedback}
      </p>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
