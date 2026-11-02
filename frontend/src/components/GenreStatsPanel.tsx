import { type KeyboardEvent, useId, useRef, useState } from "react";
import { ChartPie } from "lucide-react";
import { favoriteTypes } from "../favoritesModel.ts";
import {
  completedGenreStats,
  genrePercentage,
  type GenreShare,
  type GenreStatsMedia,
} from "../genreStats.ts";
import { formatPlaytime, type TrackingMediaType } from "../mediaTracking.ts";
import "./GenreStatsPanel.css";

interface GenreStatsPanelProps {
  items: GenreStatsMedia[];
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

const consumptionLabels: Record<TrackingMediaType, string> = {
  anime: "Episodes recorded",
  series: "Episodes recorded",
  movie: "Viewings",
  manga: "Chapters recorded",
  light_novel: "Chapters recorded",
  book: "Pages recorded",
  game: "Recorded playtime",
};

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
  { items, loading, error }: GenreStatsPanelProps,
) {
  const id = useId();
  const tabsRef = useRef<HTMLDivElement>(null);
  const [chosenType, setChosenType] = useState<TrackingMediaType | null>(null);
  const types = favoriteTypes.filter(({ value }) =>
    items.some((item) => item.type === value)
  );
  const active = types.find(({ value }) => value === chosenType) ||
    types.find(({ value }) =>
      items.some((item) => item.type === value && item.status === "completed")
    ) || types[0];
  const type = active?.value || "anime";
  const label = active?.label || "Anime";
  const stats = completedGenreStats(items, type);
  const video = type === "anime" || type === "series" || type === "movie";
  const consumption = type === "game"
    ? formatPlaytime(stats.playtimeMinutes)
    : stats.unitCount > 0
    ? stats.unitCount.toLocaleString("en")
    : "Not tracked";

  function handleTabKey(
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) {
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % types.length;
    else if (event.key === "ArrowLeft") {
      next = (index + types.length - 1) % types.length;
    } else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = types.length - 1;
    else return;
    event.preventDefault();
    setChosenType(types[next].value);
    tabsRef.current?.querySelectorAll<HTMLButtonElement>("[role=tab]")[next]
      ?.focus();
  }

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
        : (
          <>
            <div
              className="genre-stats-tabs"
              role="tablist"
              aria-label="Statistics categories"
              ref={tabsRef}
            >
              {types.map(({ value, label: tabLabel }, index) => (
                <button
                  type="button"
                  role="tab"
                  id={`${id}-tab-${value}`}
                  key={value}
                  aria-selected={type === value}
                  aria-controls={`${id}-panel-${value}`}
                  tabIndex={type === value ? 0 : -1}
                  onClick={() => setChosenType(value)}
                  onKeyDown={(event) => handleTabKey(event, index)}
                >
                  {tabLabel}
                </button>
              ))}
            </div>
            <div
              role="tabpanel"
              id={`${id}-panel-${type}`}
              aria-labelledby={`${id}-tab-${type}`}
              tabIndex={0}
            >
              <h4>{label} stats</h4>
              {!stats.completedCount
                ? <p>No completed titles in this category yet.</p>
                : (
                  <>
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
                                    color:
                                      genreColors[index % genreColors.length],
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
                                <span
                                  className="genre-stats-bar"
                                  aria-hidden="true"
                                >
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
                        Scroll the legend to see all {stats.genres.length}{" "}
                        genres.
                      </p>
                    )}
                    {stats.taggedCount < stats.completedCount && (
                      <p className="genre-stats-coverage">
                        Genres available for {stats.taggedCount} of{" "}
                        {stats.completedCount} completed titles.
                      </p>
                    )}
                    <div className="genre-stats-consumption">
                      <dl>
                        <div>
                          <dt>Completed</dt>
                          <dd>{stats.completedCount.toLocaleString("en")}</dd>
                        </div>
                        <div>
                          <dt>{consumptionLabels[type]}</dt>
                          <dd>{consumption}</dd>
                        </div>
                        {video && (
                          <div className="genre-stats-watch-time">
                            <dt>Estimated watch time</dt>
                            <dd>
                              {stats.estimatedMinutes > 0
                                ? formatPlaytime(stats.estimatedMinutes)
                                : "Unavailable"}
                            </dd>
                          </div>
                        )}
                      </dl>
                      {stats.missingProgressCount > 0 && (
                        <p>
                          Progress is missing for {stats.missingProgressCount}
                          {" completed "}
                          {stats.missingProgressCount === 1
                            ? "title"
                            : "titles"}.
                        </p>
                      )}
                      {stats.missingRepeatCount > 0 && (
                        <p>
                          Some completed repeats have no known length and are
                          not included in the progress totals.
                        </p>
                      )}
                      {video && stats.incompleteEstimateCount > 0 && (
                        <p>
                          Watch time is incomplete for{" "}
                          {stats.incompleteEstimateCount} of{" "}
                          {stats.completedCount}{" "}
                          completed titles because runtime or progress is
                          missing.
                        </p>
                      )}
                      {type === "game" && stats.missingPlaytimeCount > 0 && (
                        <p>
                          Playtime is missing for {stats.missingPlaytimeCount}
                          {" completed "}
                          {stats.missingPlaytimeCount === 1 ? "game" : "games"}.
                        </p>
                      )}
                    </div>
                    <details className="genre-stats-method">
                      <summary>How this is calculated</summary>
                      <p>
                        Percentages use all completed {label.toLowerCase()}{" "}
                        titles, including those without genres. Each title
                        counts once per genre, regardless of repeats. Genres can
                        overlap, so percentages may add up to more than 100%.
                        The ring is sized by genre mentions.
                      </p>
                      <p>
                        {type === "game"
                          ? "Recorded playtime is cumulative and is not multiplied by replays."
                          : type === "movie"
                          ? "Each completion and recorded rewatch counts as one viewing. Watch time uses the available movie runtime."
                          : "Consumption includes recorded progress and completed repeats with a known personal or catalog total. Missing progress is not inferred from completion."}
                        {video && type !== "movie" &&
                          " Watch time uses the available average runtime per episode and is an estimate, not a timer."}
                      </p>
                    </details>
                  </>
                )}
            </div>
          </>
        )}
    </section>
  );
}
