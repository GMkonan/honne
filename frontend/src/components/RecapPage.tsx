import {
  CalendarDays,
  Download,
  History,
  Plus,
  RotateCcw,
  Share2,
  Star,
} from "lucide-react";
import { useState } from "react";
import {
  buildRecapSummary,
  type RecapActivity,
  type RecapFocus,
  type RecapMedia,
  type RecapPeriod,
  recapPeriodLabel,
  type RecapSort,
} from "../recapModel.ts";
import { createRecapImage, recapFilename } from "../services/recapImage.ts";

interface RecapPageProps {
  media: RecapMedia[];
  activities: RecapActivity[];
  profileName: string;
  loading: boolean;
  error: string;
  onRetry: () => void;
}

const typeLabels: Record<string, string> = {
  anime: "Anime",
  series: "Series",
  movie: "Movie",
  book: "Book",
  manga: "Manga",
  light_novel: "Light novel",
  game: "Game",
};

function downloadImage(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  globalThis.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function periodRange(startsAt: Date, now: Date): string {
  const formatter = new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  return `${formatter.format(startsAt)} — ${formatter.format(now)}`;
}

export function RecapPage(
  { media, activities, profileName, loading, error, onRetry }: RecapPageProps,
) {
  const [period, setPeriod] = useState<RecapPeriod>("month");
  const [focus, setFocus] = useState<RecapFocus>("finished");
  const [sort, setSort] = useState<RecapSort>("recent");
  const [imageWorking, setImageWorking] = useState<"download" | "share" | "">(
    "",
  );
  const [imageFeedback, setImageFeedback] = useState("");
  const now = new Date();
  const summary = buildRecapSummary(
    media,
    activities,
    period,
    focus,
    sort,
    now,
  );

  async function exportImage(action: "download" | "share") {
    setImageWorking(action);
    setImageFeedback("");
    try {
      const blob = await createRecapImage({
        summary,
        period,
        focus,
        profileName,
        now,
      });
      const filename = recapFilename(period, focus);
      if (action === "share") {
        const file = new File([blob], filename, { type: "image/png" });
        if (!navigator.canShare?.({ files: [file] })) {
          throw new Error("Image sharing is unavailable in this browser.");
        }
        await navigator.share({
          files: [file],
          title: "My Honne recap",
          text: recapPeriodLabel(period),
        });
        setImageFeedback("Recap shared.");
      } else {
        downloadImage(blob, filename);
        setImageFeedback("Recap downloaded.");
      }
    } catch (caught: unknown) {
      if (!(caught instanceof DOMException && caught.name === "AbortError")) {
        setImageFeedback(
          caught instanceof Error ? caught.message : "Image export failed.",
        );
      }
    } finally {
      setImageWorking("");
    }
  }

  return (
    <main className="page-container standalone-page recap-page">
      <header className="page-heading recap-heading">
        <span className="eyebrow">PERSONAL EDITION</span>
        <h1>Your Honne recap</h1>
        <p>
          Shape a private culture log from what you finished, revisited, or
          welcomed into your Library.
        </p>
      </header>

      <div className="recap-workbench">
        <aside className="recap-controls" aria-label="Recap controls">
          <div>
            <span className="recap-control-label">Period</span>
            <div className="recap-choice-grid">
              {(["week", "month", "year"] as RecapPeriod[]).map((value) => (
                <button
                  type="button"
                  aria-pressed={period === value}
                  onClick={() => setPeriod(value)}
                  key={value}
                >
                  {value === "week"
                    ? "7 days"
                    : value === "month"
                    ? "30 days"
                    : "365 days"}
                </button>
              ))}
            </div>
          </div>
          <div>
            <span className="recap-control-label">Story</span>
            <div className="recap-focus-options">
              <button
                type="button"
                aria-label="Show finished and revisited titles"
                aria-pressed={focus === "finished"}
                onClick={() => setFocus("finished")}
              >
                <History size={16} />
                <span>
                  <strong>Finished</strong>
                  <small>& revisited</small>
                </span>
              </button>
              <button
                type="button"
                aria-label="Show titles added to Library"
                aria-pressed={focus === "added"}
                onClick={() => setFocus("added")}
              >
                <Plus size={16} />
                <span>
                  <strong>Added</strong>
                  <small>to Library</small>
                </span>
              </button>
            </div>
          </div>
          <label className="recap-sort">
            <span className="recap-control-label">Order</span>
            <select
              value={sort}
              onChange={(event) => setSort(event.target.value as RecapSort)}
            >
              <option value="recent">Most recent</option>
              <option value="rating">Highest rated</option>
            </select>
          </label>
          <div className="recap-export-actions">
            <button
              type="button"
              className="primary-button"
              disabled={summary.entries.length === 0 || !!imageWorking}
              onClick={() => void exportImage("download")}
            >
              <Download size={15} />
              {imageWorking === "download" ? "Creating…" : "Download PNG"}
            </button>
            {typeof navigator.share === "function" && (
              <button
                type="button"
                disabled={summary.entries.length === 0 || !!imageWorking}
                onClick={() => void exportImage("share")}
              >
                <Share2 size={15} />
                {imageWorking === "share" ? "Creating…" : "Share image"}
              </button>
            )}
          </div>
          {imageFeedback && (
            <p className="recap-export-feedback" role="status">
              {imageFeedback}
            </p>
          )}
          <p className="recap-privacy-note">
            Built locally from your Library and retained Activity. Nothing is
            uploaded.
          </p>
        </aside>

        <section className="recap-preview" aria-label="Recap preview">
          {loading
            ? <div className="page-empty">Assembling your edition…</div>
            : error
            ? (
              <div className="page-empty" role="status">
                <p>{error}</p>
                <button
                  type="button"
                  className="primary-button"
                  onClick={onRetry}
                >
                  <RotateCcw size={15} /> Retry
                </button>
              </div>
            )
            : (
              <article className="recap-poster">
                <header className="recap-poster-header">
                  <div>
                    <span>HONNE / CULTURE LOG</span>
                    <strong>{profileName || "My Library"}</strong>
                  </div>
                  <b aria-hidden="true">本音</b>
                </header>
                <div className="recap-poster-title">
                  <span>{recapPeriodLabel(period)}</span>
                  <h2>
                    {focus === "finished"
                      ? "Stories I finished"
                      : "New on my shelf"}
                  </h2>
                  <time>{periodRange(summary.startsAt, now)}</time>
                </div>
                <div className="recap-stat-row">
                  <span>
                    <strong>{summary.completed}</strong> finished
                  </span>
                  <span>
                    <strong>{summary.repeats}</strong> revisited
                  </span>
                  <span>
                    <strong>{summary.added}</strong> added
                  </span>
                </div>
                {summary.entries.length === 0
                  ? (
                    <div className="recap-poster-empty">
                      <CalendarDays size={28} />
                      <strong>No entries for this edition</strong>
                      <span>Try another period or story.</span>
                    </div>
                  )
                  : (
                    <ol className="recap-title-grid">
                      {summary.entries.map((entry, index) => (
                        <li key={entry.media.id}>
                          <div className="recap-cover">
                            {entry.media.coverUrl
                              ? <img src={entry.media.coverUrl} alt="" />
                              : (
                                <span>
                                  {String(index + 1).padStart(2, "0")}
                                </span>
                              )}
                          </div>
                          <div>
                            <small>
                              {typeLabels[entry.media.type] || entry.media.type}
                            </small>
                            <strong>{entry.media.title}</strong>
                            <span>
                              {entry.media.rating > 0
                                ? (
                                  <>
                                    <Star size={11} fill="currentColor" />{" "}
                                    {entry.media.rating}/10
                                  </>
                                )
                                : entry.repeats > 0
                                ? `${entry.repeats} revisit${
                                  entry.repeats === 1 ? "" : "s"
                                }`
                                : "In this edition"}
                            </span>
                          </div>
                        </li>
                      ))}
                    </ol>
                  )}
                <footer>
                  <span>LOCAL BY DESIGN</span>
                  <strong>HONNE</strong>
                  <span>
                    №{" "}
                    {period === "week"
                      ? "07"
                      : period === "month"
                      ? "30"
                      : "365"}
                  </span>
                </footer>
              </article>
            )}
        </section>
      </div>
    </main>
  );
}
