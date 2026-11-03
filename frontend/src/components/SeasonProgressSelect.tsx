import type { CatalogSeason } from "./GlobalSearchBox.tsx";
import { seasonProgressOptions } from "../seasonProgress.ts";

interface SeasonProgressSelectProps {
  seasons: CatalogSeason[];
  progress: number;
  onChange: (episodes: number) => void;
}

export function SeasonProgressSelect(
  { seasons, progress, onChange }: SeasonProgressSelectProps,
) {
  const options = seasonProgressOptions(seasons);
  if (options.length === 0) return null;
  return (
    <label>
      Completed seasons
      <select
        value={options.find((option) => option.episodes === progress)
          ?.seasons ?? ""}
        onChange={(event) => {
          const option = options.find((entry) =>
            entry.seasons === Number(event.target.value)
          );
          if (option) onChange(option.episodes);
        }}
      >
        <option value="" disabled>Set episodes from seasons</option>
        {options.map((option) => (
          <option key={option.seasons} value={option.seasons}>
            {option.seasons} {option.seasons === 1 ? "season" : "seasons"} —
            {" "}
            {option
              .episodes} episodes
          </option>
        ))}
      </select>
      <small>
        Counts full seasons from the first, excluding specials. For a partial
        season, edit episodes directly. Your status stays unchanged.
      </small>
    </label>
  );
}
