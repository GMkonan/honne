import {
  CalendarDays,
  ChevronDown,
  Download,
  RotateCcw,
  Share2,
  Star,
} from "lucide-react";
import { useState } from "react";
import {
  buildMonthlyLog,
  type MonthlyLogActivity,
  monthlyLogLabel,
  type MonthlyLogMedia,
  type MonthlyLogMediaType,
} from "../monthlyLogModel.ts";
import {
  createMonthlyLogImage,
  monthlyLogFilename,
} from "../services/monthlyLogImage.ts";

interface MonthlyLogPageProps {
  media: MonthlyLogMedia[];
  activities: MonthlyLogActivity[];
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
const mediaTypeOptions: Array<{
  value: MonthlyLogMediaType;
  label: string;
}> = [
  { value: "all", label: "All media" },
  { value: "anime", label: "Anime" },
  { value: "series", label: "Series" },
  { value: "movie", label: "Movies" },
  { value: "book", label: "Books" },
  { value: "manga", label: "Manga" },
  { value: "light_novel", label: "Light novels" },
  { value: "game", label: "Games" },
];

function downloadImage(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  globalThis.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function MonthlyLogPage(
  {
    media,
    activities,
    profileName,
    loading,
    error,
    onRetry,
  }: MonthlyLogPageProps,
) {
  const [imageWorking, setImageWorking] = useState<"download" | "share" | "">(
    "",
  );
  const [imageFeedback, setImageFeedback] = useState("");
  const [mediaType, setMediaType] = useState<MonthlyLogMediaType>("all");
  const now = new Date();
  const summary = buildMonthlyLog(media, activities, now, mediaType);
  const month = monthlyLogLabel(summary.startsAt);
  const scopeLabel = mediaType === "all" ? "All media" : typeLabels[mediaType];
  const titleCount = `${summary.titles} title${
    summary.titles === 1 ? "" : "s"
  }`;
  const coverOnly = summary.titles > 15;
  const outsideImage = summary.titles - summary.entries.length;

  async function exportImage(action: "download" | "share") {
    setImageWorking(action);
    setImageFeedback("");
    try {
      const blob = await createMonthlyLogImage({
        summary,
        profileName,
      });
      const filename = monthlyLogFilename(summary.startsAt, mediaType);
      if (action === "share") {
        const file = new File([blob], filename, { type: "image/png" });
        if (!navigator.canShare?.({ files: [file] })) {
          throw new Error("Image sharing is unavailable in this browser.");
        }
        await navigator.share({
          files: [file],
          title: `My ${month} Monthly Log`,
          text: `${titleCount} in ${month}`,
        });
        setImageFeedback("Monthly Log shared.");
      } else {
        downloadImage(blob, filename);
        setImageFeedback("Monthly Log downloaded.");
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
    <main className="page-container standalone-page monthly-log-page">
      <header className="page-heading monthly-log-heading">
        <div>
          <span className="eyebrow">PREVIOUS MONTH</span>
          <h1>Monthly Log</h1>
          <p>
            A chronological record of what you finished and revisited—never a
            favorites list.
          </p>
        </div>
      </header>

      <section className="monthly-log-toolbar" aria-label="Monthly Log export">
        <div className="monthly-log-period">
          <CalendarDays size={18} aria-hidden="true" />
          <span>
            <small>YOUR MONTH IN MEDIA</small>
            <strong>{month}</strong>
          </span>
        </div>
        <label className="monthly-log-media-filter">
          <span>Media type</span>
          <span className="monthly-log-select">
            <select
              value={mediaType}
              onChange={(event) => {
                setMediaType(event.target.value as MonthlyLogMediaType);
                setImageFeedback("");
              }}
            >
              {mediaTypeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <ChevronDown size={15} aria-hidden="true" />
          </span>
        </label>
        <dl className="monthly-log-summary">
          <div>
            <dt>Titles</dt>
            <dd>{summary.titles}</dd>
          </div>
          <div>
            <dt>Finished</dt>
            <dd>{summary.completed}</dd>
          </div>
          <div>
            <dt>Revisited</dt>
            <dd>{summary.repeats}</dd>
          </div>
        </dl>
        <div className="monthly-log-export-actions">
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
              {imageWorking === "share" ? "Creating…" : "Share"}
            </button>
          )}
        </div>
        {imageFeedback && (
          <p className="monthly-log-feedback" role="status">{imageFeedback}</p>
        )}
        <p className="monthly-log-privacy">
          <strong>Private by design.</strong>{" "}
          Built locally from your Activity; nothing is uploaded.
        </p>
      </section>

      <section className="monthly-log-preview" aria-label="Monthly Log preview">
        {loading
          ? <div className="page-empty">Opening last month’s log…</div>
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
            <article
              className={`monthly-log-poster ${
                coverOnly ? "is-cover-only" : "is-detailed"
              }`}
            >
              <header className="monthly-log-poster-header">
                <div>
                  <span>HONNE</span>
                  <strong>{profileName || "My Library"}</strong>
                </div>
                <b aria-hidden="true">本音</b>
              </header>
              <div className="monthly-log-poster-title">
                <h2>{month}</h2>
              </div>
              {summary.entries.length === 0
                ? (
                  <div className="monthly-log-empty">
                    <CalendarDays size={28} />
                    <strong>No completed or revisited titles</strong>
                    <span>Your next Monthly Log will be waiting.</span>
                  </div>
                )
                : (
                  <ol className="monthly-log-title-grid">
                    {summary.entries.map((entry, index) => (
                      <li key={entry.media.id}>
                        <div className="monthly-log-cover">
                          {entry.media.coverUrl
                            ? (
                              <img
                                src={entry.media.coverUrl}
                                alt={coverOnly ? entry.media.title : ""}
                              />
                            )
                            : <span>{String(index + 1).padStart(2, "0")}</span>}
                        </div>
                        {!coverOnly && (
                          <div>
                            <small>
                              {typeLabels[entry.media.type] || entry.media.type}
                            </small>
                            <strong>{entry.media.title}</strong>
                            <span>
                              {entry.media.rating > 0 && (
                                <>
                                  <Star size={10} fill="currentColor" />{" "}
                                  {entry.media.rating}/10
                                </>
                              )}
                              {entry.media.rating > 0 && entry.repeats > 0 &&
                                " · "}
                              {entry.repeats > 0
                                ? `${entry.repeats} revisit${
                                  entry.repeats === 1 ? "" : "s"
                                }`
                                : entry.media.rating <= 0
                                ? "Finished"
                                : null}
                            </span>
                          </div>
                        )}
                      </li>
                    ))}
                  </ol>
                )}
              <footer className="monthly-log-poster-footer">
                <span>
                  <strong>{summary.completed}</strong> finished
                  {summary.repeats > 0 && (
                    <>
                      {" "}· <strong>{summary.repeats}</strong> revisited
                    </>
                  )}
                  {outsideImage > 0 && (
                    <>
                      {" "}· <strong>{summary.entries.length}</strong>{" "}
                      newest shown · <strong>+{outsideImage}</strong>{" "}
                      outside image
                    </>
                  )}
                </span>
                <strong>{scopeLabel}</strong>
              </footer>
            </article>
          )}
      </section>
    </main>
  );
}
