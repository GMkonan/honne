import { type ReactNode, useState } from "react";
import { ArrowRight, Clock3 } from "lucide-react";
import {
  activityDescription,
  type ActivityEvent,
  relativeTime,
} from "../activityModel.ts";
import { type FavoriteCandidate, favoriteTypes } from "../favoritesModel.ts";
import type { GenreStatsMedia, StatisticsMediaType } from "../genreStats.ts";
import { ConsumptionPanel } from "./ConsumptionPanel.tsx";
import { FavoriteCover } from "./FavoriteCover.tsx";
import { GenreStatsPanel } from "./GenreStatsPanel.tsx";
import { LibrarySectionNav } from "./LibrarySectionNav.tsx";

interface OverviewMedia extends FavoriteCandidate, GenreStatsMedia {
  rating: number;
}

interface OverviewPageProps {
  items: OverviewMedia[];
  activities: ActivityEvent[];
  loading: boolean;
  activityLoading: boolean;
  error: string;
  activityError?: string;
  notice?: string;
  favorites: ReactNode;
  onOpen: (id: number) => void;
}

export function OverviewPage(
  {
    items,
    activities,
    loading,
    activityLoading,
    error,
    activityError = "",
    notice = "",
    favorites,
    onOpen,
  }: OverviewPageProps,
) {
  const [statisticsType, setStatisticsType] = useState<StatisticsMediaType>(
    "all",
  );
  const statisticsItems = items.filter((item) =>
    statisticsType === "all" || item.type === statisticsType
  );
  const selectedLabel = statisticsType === "all"
    ? "All media"
    : favoriteTypes.find(({ value }) => value === statisticsType)?.label ||
      "Media";
  const rated = statisticsItems.filter((item) =>
    Number.isFinite(item.rating) && item.rating > 0 && item.rating <= 10
  );
  const mean = rated.length
    ? (rated.reduce((sum, item) => sum + item.rating, 0) / rated.length)
      .toFixed(1)
    : "—";
  const metrics = [
    { label: "Total titles", value: statisticsItems.length },
    {
      label: "Completed",
      value:
        statisticsItems.filter((item) => item.status === "completed").length,
    },
    {
      label: "In progress",
      value:
        statisticsItems.filter((item) => item.status === "in_progress").length,
    },
    { label: "Mean score", value: mean },
  ];
  const byId = new Map(items.map((item) => [item.id, item]));
  const recent = [...activities].sort((a, b) =>
    Date.parse(b.occurredAt) - Date.parse(a.occurredAt) || b.id - a.id
  ).slice(0, 8);

  return (
    <main
      className="page-container content overview-page"
      tabIndex={-1}
      aria-labelledby="overview-title"
    >
      <LibrarySectionNav active="overview" />
      <header className="overview-heading">
        <h2 id="overview-title">Overview</h2>
        <a href="#library/list">
          Open Library <ArrowRight size={15} aria-hidden="true" />
        </a>
      </header>
      {(error || notice) && (
        <p className="error-banner" role="alert">{error || notice}</p>
      )}
      <fieldset className="overview-statistics-filter">
        <legend>Statistics media type</legend>
        <div>
          <button
            type="button"
            aria-pressed={statisticsType === "all"}
            onClick={() => setStatisticsType("all")}
          >
            All media
          </button>
          {favoriteTypes.map(({ value, label }) => (
            <button
              type="button"
              key={value}
              aria-pressed={statisticsType === value}
              onClick={() => setStatisticsType(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <p>
          Filters statistics only. Favorites and recent activity are unchanged.
        </p>
      </fieldset>
      <div className="overview-layout">
        <div className="overview-main">
          <section
            className="overview-summary"
            aria-labelledby="overview-summary-title"
            aria-busy={loading}
          >
            <h3 id="overview-summary-title">At a glance</h3>
            <p className="overview-statistics-scope">{selectedLabel}</p>
            <dl className="overview-metrics">
              {metrics.map(({ label, value }) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>
                    {items.length === 0 && (loading || error) ? "—" : value}
                  </dd>
                </div>
              ))}
            </dl>
            {loading && items.length > 0 && (
              <p role="status">Refreshing your Library…</p>
            )}
            {loading && items.length === 0
              ? <p role="status">Loading your Library…</p>
              : !error && statisticsItems.length === 0
              ? (
                <p>
                  {items.length === 0
                    ? "Your Library is empty. Add a title to start your collection."
                    : "No titles in this selection yet."}
                </p>
              )
              : statisticsItems.length > 0 && (
                <ul
                  className="overview-media-summary"
                  aria-label="Titles by media type"
                >
                  {favoriteTypes.map(({ value, label }) => {
                    const count = statisticsItems.filter((item) =>
                      item.type === value
                    ).length;
                    return count
                      ? (
                        <li key={value}>
                          <span>{label}</span>
                          <strong>{count}</strong>
                        </li>
                      )
                      : null;
                  })}
                </ul>
              )}
          </section>
          <div className="overview-favorites">{favorites}</div>
          <section
            className="overview-activity"
            aria-labelledby="overview-activity-title"
            aria-busy={activityLoading}
          >
            <header>
              <h3 id="overview-activity-title">Recent activity</h3>
              <a href="#activity">
                View all <ArrowRight size={14} aria-hidden="true" />
              </a>
            </header>
            {activityLoading && recent.length > 0 && (
              <p role="status">Refreshing recent activity…</p>
            )}
            {activityError && <p role="alert">{activityError}</p>}
            {activityLoading && recent.length === 0
              ? <p role="status">Loading recent activity…</p>
              : activityError && recent.length === 0
              ? <p>Recent activity could not be loaded.</p>
              : recent.length === 0
              ? (
                <div className="overview-activity-empty">
                  <Clock3 size={24} aria-hidden="true" />
                  <h4>No activity yet</h4>
                  <p>Your next Library change will start the journal.</p>
                </div>
              )
              : (
                <ol className="overview-activity-list">
                  {recent.map((activity) => {
                    const media = byId.get(activity.mediaId || 0);
                    const canOpen = !!media && activity.action !== "deleted";
                    return (
                      <li key={activity.id}>
                        <button
                          type="button"
                          disabled={!canOpen}
                          onClick={() => media && onOpen(media.id)}
                        >
                          <span className="overview-activity-cover">
                            <FavoriteCover
                              title={activity.title}
                              coverUrl={media?.coverUrl || ""}
                            />
                          </span>
                          <span className="overview-activity-copy">
                            <strong>{activity.title}</strong>
                            <span>{activityDescription(activity)}</span>
                            <time dateTime={activity.occurredAt}>
                              {relativeTime(activity.occurredAt)}
                            </time>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ol>
              )}
          </section>
        </div>
        <div className="overview-sidebar">
          <GenreStatsPanel
            items={items}
            type={statisticsType}
            loading={loading}
            error={error}
          />
          <ConsumptionPanel
            items={items}
            type={statisticsType}
            loading={loading}
            error={error}
          />
        </div>
      </div>
    </main>
  );
}
