# Completed-only genre statistics

Owner decisions (2026-11-02): add one Overview card above favorites, with tabs
for media types present in the Library. Use only `completed` titles for genre
percentages and the consumption summary. Include the donut, leading genre,
percentage legend, completed count, recorded consumption, and available video
watch-time estimates. Do not introduce comparisons with other users.

This is a read-only frontend projection of the existing Library response. It
adds no API calls, database changes, dependencies, telemetry, or provider requests.
Source changes do not authorize updating a running installation.

## Calculation contract

- The denominator is every completed title of the selected type, including titles
  without genre metadata. Show genre-metadata coverage when incomplete.
- Count a title once per genre; trim and collapse whitespace, deduplicate genres
  case-insensitively, and ignore empty names. Repeats do not weight genres.
- Sort by descending title count, breaking ties alphabetically in English. The
  center shows the leading genre. Nonzero shares below 1% display as `<1%`.
- Genres overlap, so legend percentages may total more than 100%. Donut segments
  use each genre's share of all genre mentions, not its title percentage. Explain
  both denominators in the accessible chart description and calculation details.
- Retain all genres, including long names. The legend scrolls vertically and is
  keyboard-focusable; no genre disappears because of a top-seven cutoff.
- Episode, chapter, and page totals use recorded progress plus additional completed
  repeats multiplied by the personal total, falling back to the catalog total
  only when the personal total is absent. Do not infer missing initial progress
  from `completed`; identify missing progress and unknown repeat lengths.
- Each completed movie counts as one viewing plus its recorded rewatches. Movie
  progress fields are not treated as episode counts.
- Sum recorded game playtime as-is; do not multiply cumulative time by replays.
  Do not estimate reading time or game time from catalog durations.
- Video time uses recorded episode consumption times the available average episode
  duration, or movie viewings times runtime. Label it as an estimate and identify
  incomplete coverage. Missing data is not represented as a known zero.
- Keep valid statistics visible while the Library refreshes or a refresh fails.
  Distinguish initial loading, an empty Library, unavailable data, a category with
  no completions, and completed titles without genres.

## Validation

Unit coverage exercises completed/type filtering, overlapping genres, missing
metadata, deduplication, stable ordering, all consumption units, repeats, partial
time estimates, cumulative game playtime, invalid counters, and rare genres.
Component coverage checks accessible labels, arrow/Home/End tab navigation and
focus, category changes/removal, loading and failure states, partial coverage,
untrusted labels, scrollable legends, and integration above Overview favorites.

Manual browser checks still required: 320 px, tablet, desktop, and 200% zoom;
long/many genres; one genre; keyboard scrolling; visible focus; donut/legend
alignment; and unchanged favorites behavior. This environment's browser tool
reports that Chromium/Google Chrome is not installed, so layout and zoom were
not visually validated. No browser dependency was installed.

### Executed checks (2026-11-02)

- Repository format, Go vet/race tests, frontend lint/typecheck, all 155 workspace
  tests, production build, and Compose configuration passed.
- The final staged feature was also validated without the pre-existing uncommitted
  season-progress changes: lint, typecheck, all 150 tests, and build passed.
- The final presentation adjustments passed the 26 focused statistics/Overview
  tests, format, lint, typecheck, and build again.
- Static text/legend color contrast against the card background exceeded 4.5:1
  for every color used. This does not replace real-browser accessibility checks.
