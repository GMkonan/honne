import { useId } from "react";
import { Clock3 } from "lucide-react";
import { favoriteTypes } from "../favoritesModel.ts";
import {
  completedGenreStats,
  type GenreStatsMedia,
  type StatisticsMediaType,
} from "../genreStats.ts";
import { formatPlaytime, type TrackingMediaType } from "../mediaTracking.ts";
import "./ConsumptionPanel.css";

interface ConsumptionPanelProps {
  items: GenreStatsMedia[];
  type: StatisticsMediaType;
  loading: boolean;
  error: string;
}

const consumptionLabels: Record<TrackingMediaType, string> = {
  anime: "Episodes recorded",
  series: "Episodes recorded",
  movie: "Viewings",
  manga: "Chapters recorded",
  light_novel: "Chapters recorded",
  book: "Pages recorded",
  game: "Recorded playtime",
};

export function ConsumptionPanel(
  { items, type, loading, error }: ConsumptionPanelProps,
) {
  const id = useId();
  const groups = favoriteTypes.filter(({ value }) =>
    type === "all" || type === value
  )
    .map(({ value, label }) => ({
      type: value,
      label,
      stats: completedGenreStats(items, value),
    })).filter(({ stats }) => stats.completedCount > 0);

  return (
    <section
      className="consumption-card"
      aria-labelledby={`${id}-heading`}
      aria-busy={loading}
    >
      <header className="consumption-heading">
        <h3 id={`${id}-heading`}>
          <Clock3 size={18} aria-hidden="true" /> Consumption
        </h3>
        <span>Completed only</span>
      </header>
      {loading && (
        <p role="status">
          {items.length ? "Refreshing consumption…" : "Loading consumption…"}
        </p>
      )}
      {groups.length === 0
        ? !loading && (
          <p>
            {error && items.length === 0
              ? "Consumption is unavailable until your Library can be loaded."
              : "No completed titles in this selection yet."}
          </p>
        )
        : groups.map(({ type: groupType, label, stats }) => {
          const video = groupType === "anime" || groupType === "series" ||
            groupType === "movie";
          const consumption = groupType === "game"
            ? formatPlaytime(stats.playtimeMinutes)
            : stats.unitCount > 0
            ? stats.unitCount.toLocaleString("en")
            : "Not tracked";
          return (
            <section
              key={groupType}
              className="consumption-group"
              aria-label={`${label} consumption`}
            >
              <h4>{label}</h4>
              <dl>
                <div>
                  <dt>Completed</dt>
                  <dd>{stats.completedCount.toLocaleString("en")}</dd>
                </div>
                <div>
                  <dt>{consumptionLabels[groupType]}</dt>
                  <dd>{consumption}</dd>
                </div>
                {video && (
                  <div className="consumption-watch-time">
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
                  Progress is missing for {stats.missingProgressCount} completed
                  {" "}
                  {stats.missingProgressCount === 1 ? "title" : "titles"}.
                </p>
              )}
              {stats.missingRepeatCount > 0 && (
                <p>
                  Some completed repeats have no known length and are not
                  included in the progress totals.
                </p>
              )}
              {video && stats.incompleteEstimateCount > 0 && (
                <p>
                  Watch time is incomplete for {stats.incompleteEstimateCount}
                  {" "}
                  of {stats.completedCount}{" "}
                  completed titles because runtime or progress is missing.
                </p>
              )}
              {groupType === "game" && stats.missingPlaytimeCount > 0 && (
                <p>
                  Playtime is missing for {stats.missingPlaytimeCount} completed
                  {" "}
                  {stats.missingPlaytimeCount === 1 ? "game" : "games"}.
                </p>
              )}
            </section>
          );
        })}
      {groups.length > 0 && (
        <details className="consumption-method">
          <summary>How consumption is calculated</summary>
          <p>
            Consumption uses only completed titles in the selected media type.
            All media keeps each type and its units separate.
          </p>
          <p>
            Episode, chapter, and page totals include recorded progress and
            completed repeats with a known personal or catalog total. Missing
            progress is not inferred from completion.
          </p>
          <p>
            Each completed movie and recorded rewatch counts as a viewing. Watch
            time uses available movie runtimes or average episode durations and
            is an estimate, not a timer.
          </p>
          <p>
            Recorded game playtime is cumulative and is not multiplied by
            replays. Reading time and unrecorded game time are not estimated.
          </p>
        </details>
      )}
    </section>
  );
}
