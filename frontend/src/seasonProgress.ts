import type { CatalogSeason } from "./components/GlobalSearchBox.tsx";

export interface SeasonProgressOption {
  seasons: number;
  episodes: number;
}

export function seasonProgressOptions(
  seasons: CatalogSeason[],
): SeasonProgressOption[] {
  const regular = seasons.filter((season) => season.seasonNumber > 0)
    .sort((a, b) => a.seasonNumber - b.seasonNumber);
  const options: SeasonProgressOption[] = [];
  let episodes = 0;
  for (const season of regular) {
    if (
      season.seasonNumber !== options.length + 1 ||
      season.completed !== true ||
      !Number.isSafeInteger(season.episodeCount) ||
      (season.episodeCount ?? 0) <= 0 ||
      !Number.isSafeInteger(episodes + (season.episodeCount ?? 0))
    ) break;
    episodes += season.episodeCount ?? 0;
    options.push({ seasons: season.seasonNumber, episodes });
  }
  return options;
}
