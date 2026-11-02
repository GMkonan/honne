import { useId } from "react";
import { ChartPie } from "lucide-react";
import { favoriteTypes } from "../favoritesModel.ts";
import {
  completedGenreDistribution,
  genrePercentage,
  type GenreShare,
  type GenreStatsMedia,
  type StatisticsMediaType,
} from "../genreStats.ts";
import "./GenreStatsPanel.css";

interface GenreStatsPanelProps {
  items: GenreStatsMedia[];
  type: StatisticsMediaType;
  loading: boolean;
  error: string;
}

const genreColors = [
  "var(--yellow)",
  "#fab387",
  "var(--red)",
  "var(--mauve)",
  "var(--sapphire)",
  "var(--blue)",
  "var(--green)",
];

function GenreDonut(
  { genres, label }: { genres: GenreShare[]; label: string },
) {
  const id = useId();
  const mentions = genres.reduce((sum, genre) => sum + genre.count, 0);
  let offset = 0;
  return (
    <div className="genre-stats-donut">
      <svg
        viewBox="0 0 100 100"
        role="img"
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-description`}
      >
        <title id={`${id}-title`}>Completed {label} genre distribution</title>
        <desc id={`${id}-description`}>
          Ring segments are proportional to genre mentions. The center and
          legend show the percentage of completed titles with each genre, not
          the size of the ring segment. A title may have several genres.
        </desc>
        {genres.map((genre, index) => {
          const share = genre.count / mentions * 100;
          const start = offset;
          offset += share;
          return (
            <circle
              key={genre.name}
              cx="50"
              cy="50"
              r="42"
              fill="none"
              stroke={genreColors[index % genreColors.length]}
              strokeWidth="13"
              pathLength="100"
              strokeDasharray={`${share} ${100 - share}`}
              strokeDashoffset={-start}
              transform="rotate(-90 50 50)"
            />
          );
        })}
      </svg>
      <div className="genre-stats-center" aria-hidden="true">
        <strong>{genrePercentage(genres[0].percentage)}</strong>
        <span>{genres[0].name}</span>
      </div>
    </div>
  );
}

export function GenreStatsPanel(
  { items, type, loading, error }: GenreStatsPanelProps,
) {
  const id = useId();
  const label = type === "all"
    ? "All media"
    : favoriteTypes.find(({ value }) => value === type)?.label || "Media";
  const stats = completedGenreDistribution(items, type);

  return (
    <section
      className="genre-stats-card"
      aria-labelledby={`${id}-heading`}
      aria-busy={loading}
    >
      <header className="genre-stats-heading">
        <h3 id={`${id}-heading`}>
          <ChartPie size={18} aria-hidden="true" /> Genre stats
        </h3>
        <span>Completed only</span>
      </header>
      <h4>{label}</h4>
      {loading && (
        <p role="status">
          {items.length ? "Refreshing genre stats…" : "Loading genre stats…"}
        </p>
      )}
      {items.length === 0
        ? !loading && (
          <p>
            {error
              ? "Genre stats are unavailable until your Library can be loaded."
              : "Complete a title to see your genre stats."}
          </p>
        )
        : !stats.completedCount
        ? <p>No completed titles in this selection yet.</p>
        : (
          <>
            <p>
              Based on {stats.completedCount} completed{" "}
              {stats.completedCount === 1 ? "title" : "titles"}.
            </p>
            {stats.genres.length > 0
              ? (
                <div className="genre-stats-visual">
                  <GenreDonut genres={stats.genres} label={label} />
                  <ul
                    className="genre-stats-legend"
                    aria-label={`${label} genres`}
                    tabIndex={0}
                  >
                    {stats.genres.map((genre, index) => (
                      <li key={genre.name}>
                        <span
                          className="genre-stats-percent"
                          style={{
                            color: genreColors[index % genreColors.length],
                          }}
                        >
                          {genrePercentage(genre.percentage)}
                        </span>
                        <span className="genre-stats-name">
                          {genre.name}
                          <span className="sr-only">
                            {", "}
                            {genre.count} of {stats.completedCount}
                            {" completed titles"}
                          </span>
                        </span>
                        <span className="genre-stats-bar" aria-hidden="true">
                          <span
                            style={{
                              width: `${genre.percentage}%`,
                              background:
                                genreColors[index % genreColors.length],
                            }}
                          />
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )
              : <p>No genre metadata for completed titles yet.</p>}
            {stats.genres.length > 7 && (
              <p className="genre-stats-scroll-help">
                Scroll the legend to see all {stats.genres.length} genres.
              </p>
            )}
            {stats.taggedCount < stats.completedCount && (
              <p className="genre-stats-coverage">
                Genres available for {stats.taggedCount} of{" "}
                {stats.completedCount} completed titles.
              </p>
            )}
            <details className="genre-stats-method">
              <summary>How this is calculated</summary>
              <p>
                Percentages use all completed titles in the selected media type,
                including those without genres. Each title counts once per
                genre, regardless of repeats. Genres can overlap, so percentages
                may add up to more than 100%. The ring is sized by genre
                mentions.
              </p>
            </details>
          </>
        )}
    </section>
  );
}
