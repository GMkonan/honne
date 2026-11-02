import type { GenreStatsMedia } from "./genreStats.ts";
import type { TrackingMediaType } from "./mediaTracking.ts";

function recordedCount(value?: number): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : 0;
}

export function consumptionStats(
  items: readonly GenreStatsMedia[],
  type: TrackingMediaType,
) {
  let titleCount = 0;
  let completedCount = 0;
  let unitCount = 0;
  let inferredProgressCount = 0;
  let missingProgressCount = 0;
  let missingRepeatCount = 0;
  let estimatedMinutes = 0;
  let incompleteEstimateCount = 0;
  let playtimeMinutes = 0;
  let missingPlaytimeCount = 0;

  for (const item of items) {
    if (item.type !== type) continue;
    const completed = item.status === "completed";
    const repeats = recordedCount(item.repeatCount);
    const progress = recordedCount(item.progress);
    const minutes = recordedCount(item.playtimeMinutes);
    const recorded = type === "game"
      ? minutes > 0 || repeats > 0
      : type === "movie"
      ? repeats > 0
      : progress > 0 || repeats > 0;
    if (!completed && !recorded) continue;
    titleCount++;
    if (completed) completedCount++;

    if (type === "game") {
      playtimeMinutes += minutes;
      if (!minutes) missingPlaytimeCount++;
      continue;
    }

    const total = recordedCount(item.total) || recordedCount(item.catalogTotal);
    const inferProgress = type !== "movie" && completed && !progress &&
      (item.progress === undefined || item.progress === 0) && total > 0;
    const initialProgress = inferProgress ? total : progress;
    // Rewatches also establish a movie's first viewing, even if its status changes.
    const units = type === "movie"
      ? 1 + repeats
      : initialProgress + repeats * total;
    const missingProgress = type !== "movie" && completed && !initialProgress;
    const missingRepeat = type !== "movie" && repeats > 0 && !total;
    unitCount += units;
    if (inferProgress) inferredProgressCount++;
    if (missingProgress) missingProgressCount++;
    if (missingRepeat) missingRepeatCount++;

    if (type === "anime" || type === "series" || type === "movie") {
      const duration = recordedCount(item.durationMinutes);
      estimatedMinutes += units * duration;
      if (!duration || missingProgress || missingRepeat) {
        incompleteEstimateCount++;
      }
    }
  }

  return {
    titleCount,
    completedCount,
    unitCount,
    inferredProgressCount,
    missingProgressCount,
    missingRepeatCount,
    estimatedMinutes,
    incompleteEstimateCount,
    playtimeMinutes,
    missingPlaytimeCount,
  };
}
