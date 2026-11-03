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
          const unitLabel = consumptionLabels[groupType].toLowerCase();
          return (
            <section
              key={groupType}
              className="consumption-group"
              aria-label={`${label} consumption`}
            >
              <h4>{label}</h4>
              <dl>
                <div>
                  <dt className="sr-only">{consumptionLabels[groupType]}</dt>
                  <dd>
                    {consumption}
                    {groupType !== "game" && stats.unitCount > 0 && (
                      <span className="consumption-unit">
                        {` ${
                          stats.unitCount === 1
                            ? unitLabel.slice(0, -1)
                            : unitLabel
                        }`}
                      </span>
                    )}
                    {partialConsumption && (
                      <span className="consumption-badge">&#32;Partial</span>
                    )}
                  </dd>
                </div>
                {video && (
                  <div className="consumption-watch-time">
                    <dt className="sr-only">Watch time</dt>
                    <dd>
                      {stats.estimatedMinutes > 0
                        ? (
                          <span>
                            <span className="sr-only">
                              {"Estimated "}
                            </span>~{formatPlaytime(stats.estimatedMinutes)}
                          </span>
                        )
                        : "Time unknown"}
                      {stats.estimatedMinutes > 0 &&
                        stats.incompleteEstimateCount > 0 && (
                        <span className="consumption-badge">&#32;Partial</span>
                      )}
                    </dd>
                  </div>
                )}
              </dl>
            </section>
          );
        })}
    </section>
  );
}
