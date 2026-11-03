import { useId } from "react";
import { Clock3 } from "lucide-react";
import { consumptionStats } from "../consumptionStats.ts";
import { favoriteTypes } from "../favoritesModel.ts";
import type { GenreStatsMedia, StatisticsMediaType } from "../genreStats.ts";
import { formatPlaytime, type TrackingMediaType } from "../mediaTracking.ts";
import "./ConsumptionPanel.css";

interface ConsumptionPanelProps {
  items: GenreStatsMedia[];
  type: StatisticsMediaType;
  loading: boolean;
  error: string;
}

const consumptionLabels: Record<TrackingMediaType, string> = {
  anime: "Episodes",
  series: "Episodes",
  movie: "Viewings",
  manga: "Chapters",
  light_novel: "Chapters",
  book: "Pages",
  game: "Playtime",
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
      stats: consumptionStats(items, value),
    })).filter(({ stats }) => stats.titleCount > 0);

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
              : "No consumption recorded in this selection yet."}
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
          const partialConsumption = groupType === "game"
            ? stats.playtimeMinutes > 0 && stats.missingPlaytimeCount > 0
            : stats.unitCount > 0 &&
              (stats.missingProgressCount > 0 || stats.missingRepeatCount > 0);
          return (
            <section
              key={groupType}
              className="consumption-group"
              aria-label={`${label} consumption`}
            >
              <h4>{label}</h4>
              <dl>
                <div>
                  <dt>{consumptionLabels[groupType]}</dt>
                  <dd>
                    {consumption}
                    {partialConsumption && (
                      <span className="consumption-badge">Partial</span>
                    )}
                  </dd>
                </div>
                {video && (
                  <div>
                    <dt>Watch time</dt>
                    <dd>
                      {stats.estimatedMinutes > 0
                        ? (
                          <span>
                            <span className="sr-only">
                              {"Estimated "}
                            </span>~{formatPlaytime(stats.estimatedMinutes)}
                          </span>
                        )
                        : "Unknown"}
                      {stats.estimatedMinutes > 0 &&
                        stats.incompleteEstimateCount > 0 && (
                        <span className="consumption-badge">Partial</span>
                      )}
                    </dd>
                  </div>
                )}
              </dl>
            </section>
          );
        })}
      {groups.length > 0 && (
        <details className="consumption-method">
          <summary>Details</summary>
          <p>
            Includes recorded progress in every status. Unstarted titles are
            excluded. Each media type keeps its own units.
          </p>
          <p>
            Completed titles without progress use known totals. Repeats use
            known lengths. Saved progress is not changed.
          </p>
          <p>
            ~ marks estimated watch time from available runtimes. Partial totals
            exclude missing data; durations are not guessed. Game playtime is
            cumulative, not multiplied by replays. Reading time is not
            estimated.
          </p>
          {groups.map(({ type: groupType, label, stats }) => (
            <ConsumptionDetails key={groupType} label={label} stats={stats} />
          ))}
        </details>
      )}
    </section>
  );
}

function ConsumptionDetails({ label, stats }: {
  label: string;
  stats: ReturnType<typeof consumptionStats>;
}) {
  return (
    <section aria-label={`${label} calculation details`}>
      <h4>{label}</h4>
      <p>
        {stats.titleCount} {stats.titleCount === 1 ? "title" : "titles"},{" "}
        {stats.completedCount} completed.
      </p>
      <ul>
        {stats.inferredProgressCount > 0 && (
          <li>
            Known totals used for {stats.inferredProgressCount} completed{" "}
            {stats.inferredProgressCount === 1 ? "title" : "titles"}{" "}
            without progress.
          </li>
        )}
        {stats.missingProgressCount > 0 && (
          <li>
            Progress missing for {stats.missingProgressCount} completed{" "}
            {stats.missingProgressCount === 1 ? "title" : "titles"}.
          </li>
        )}
        {stats.missingRepeatCount > 0 && (
          <li>
            {stats.missingRepeatCount} {stats.missingRepeatCount === 1
              ? "title has repeats"
              : "titles have repeats"} with unknown length.
          </li>
        )}
        {stats.incompleteEstimateCount > 0 && (
          <li>
            Watch time missing data for {stats.incompleteEstimateCount} of{" "}
            {stats.titleCount} {stats.titleCount === 1 ? "title" : "titles"}.
          </li>
        )}
        {stats.missingPlaytimeCount > 0 && (
          <li>
            Playtime missing for {stats.missingPlaytimeCount}{" "}
            {stats.missingPlaytimeCount === 1 ? "game" : "games"}.
          </li>
        )}
      </ul>
    </section>
  );
}
