# Genre and consumption statistics

Owner decisions (2026-11-02, revised layout): favorites occupy Overview's larger
column. Keep Genre stats and Consumption as separate cards in the smaller column.
One shared `All media` / media-type filter controls At a glance, Genre stats, and
Consumption, without filtering favorites, recent activity, the hero, or the
Library list. The statistics filter defaults to All media and stays selected when
its category becomes empty. Genres use only `completed` titles. Consumption uses
recorded progress across all statuses, and completion or known totals as described
below (owner revision, 2026-11-02). At a glance retains its all-status counts and
rated-title mean within the type. Do not introduce comparisons with other users.

This is a read-only frontend projection of the existing Library response. It
adds no API calls, database changes, dependencies, telemetry, or provider requests.
Source changes do not authorize updating a running installation.

## Calculation contract

- The denominator is every completed title of the selected type, including titles
  without genre metadata. All media combines completed titles of all types, not
  the average of their percentages. Show genre-metadata coverage when incomplete.
- Count a title once per genre; trim and collapse whitespace, deduplicate genres
  case-insensitively, and ignore empty names. Repeats do not weight genres.
- Sort by descending title count, breaking ties alphabetically in English. The
  center shows the leading genre. Nonzero shares below 1% display as `<1%`.
- Genres overlap, so legend percentages may total more than 100%. Donut segments
  use each genre's share of all genre mentions, not its title percentage. Explain
  both denominators in the accessible chart description and calculation details.
- Retain all genres, including long names. The legend scrolls vertically and is
  keyboard-focusable; no genre disappears because of a top-seven cutoff.
  Show the supporting completed-title count (`count / completedCount`) below each
  genre name. Keep the percentage unbroken and the count readable when names wrap;
  do not clamp percentage points to a 0–1 fraction or normalize title shares to
  make their sum 100%.
- Episode, chapter, and page totals use recorded progress plus additional completed
  repeats multiplied by the personal total, falling back to the catalog total
  only when the personal total is absent. Include positive progress regardless of
  status: watching/reading/playing, paused, dropped, and even planned entries with
  existing recorded consumption. Unstarted entries do not contribute.
- Only for `completed` titles with absent or zero progress, use the personal total
  or, if absent, the catalog total. This is a read-only display inference. Never
  replace positive progress with the available total, infer consumption for an
  unfinished title, mutate saved data, or turn invalid counters into estimates.
  Identify completed titles with neither progress nor a known total and repeats
  with unknown lengths. Keep consumption calculations separate from genre counts.
- Each completed movie counts as one viewing plus its recorded rewatches. A movie
  with recorded rewatches also establishes its initial viewing if its status has
  changed. Without either completion or rewatches, no viewing is assumed. Movie
  progress fields are not treated as episode counts.
- Sum recorded game playtime as-is; do not multiply cumulative time by replays.
  Do not estimate reading time or game time from catalog durations.
- In All media, Consumption lists each type separately. Never add episodes to
  pages/chapters, or recorded game time to estimated watch time.
- Video time uses recorded episode consumption times the available average episode
  duration, or movie viewings times runtime. Label it as an estimate and identify
  incomplete coverage. Watch-time values use `~` (with an accessible `Estimated`
  prefix), with a visible `Partial` badge when runtime/progress is missing. An
  entirely unknown time is `Time unknown`; unrecorded consumption is `Not tracked`.
  Missing data is not represented as a known zero or replaced with guessed runtimes.
- Keep valid statistics visible while the Library refreshes or a refresh fails.
  Distinguish initial loading, an empty Library, unavailable data, a category with
  no completions, completed titles without genres, and no recorded consumption.

## Presentation

Owner revision (2026-11-03, compact list): remove `Details` and all explanatory
sections entirely. Use one compact row per media type: name on the left, consumed
quantity with an inline singular/plural unit on the right, and estimated video
time beneath it. Game time is the primary value, without a redundant unit label.
Keep semantic definition-list labels available to assistive technology without
repeating them visibly. Completed counts already appear in At a glance.

Use 18 px primary values, readable 14 px media/unit/time text, subtle separators,
and wrapping that fits narrow viewports. Retain `~` and its accessible `Estimated`
prefix, visible `Partial` badges for positive incomplete totals, and explicit
unknown/untracked values. There are no calculation notes or disclosure controls
in this card. Calculation rules remain documented here and must not change with
presentation, merge unrelated units, mutate saved data, or make partial totals
look complete.

## Validation

Unit coverage exercises completed/type filtering, overlapping genres, missing
metadata, deduplication, stable ordering, all consumption units, repeats, partial
time estimates, cumulative game playtime, invalid counters, and rare genres.
Consumption regressions cover 1,000 consumed units of 1,500 available for each
numeric media type, recorded progress in every status, completed-only total
fallbacks without mutation, inferred completed progress, incomplete time labels,
and ongoing-only selections through the shared filter while genres stay unchanged.
Component coverage checks accessible labels, shared native-button filtering by
keyboard, unchanged favorites/activity, empty selected categories, loading and
failure states, partial coverage, untrusted labels, scrollable legends, and the
separation of genre/consumption cards after favorites in the source order.

Manual browser checks still required: 320 px, tablet, desktop, and 200% zoom;
long/many genres; one genre; keyboard scrolling; visible focus; donut/legend
alignment; and unchanged favorites behavior. This environment's browser tool
reports that Chromium/Google Chrome is not installed, so layout and zoom were
not visually validated. No browser dependency was installed.

### Executed checks for the initial card (2026-11-02)

- Repository format, Go vet/race tests, frontend lint/typecheck, all 155 workspace
  tests, production build, and Compose configuration passed.
- The final staged feature was also validated without the pre-existing uncommitted
  season-progress changes: lint, typecheck, all 150 tests, and build passed.
- The final presentation adjustments passed the 26 focused statistics/Overview
  tests, format, lint, typecheck, and build again.
- Static text/legend color contrast against the card background exceeded 4.5:1
  for every color used. This does not replace real-browser accessibility checks.

### Executed checks for the revised layout (2026-11-02)

- Repository format, lint, strict typecheck, all 165 workspace frontend tests,
  production build, Go vet/race tests, and Compose configuration passed.
- The staged feature, excluding the pre-existing uncommitted season-progress
  changes, also passed lint, typecheck, all 160 tests, and build.
- Coverage now includes one shared filter controlling all three statistics cards,
  unchanged favorites/activity, separate consumption units in All media, safe cover
  previews, native keyboard operation, sidebar source order, and combined Library
  media/status/search/reset behavior.
- Real-browser layout checks remain pending, including the vertical Library media
  strips at 320 px, tablet, desktop, and 200% zoom. No browser was available and no
  dependency was added.

### Executed checks for partial consumption and compact favorites (2026-11-02)

- Repository format, lint, strict typecheck, all 184 workspace frontend tests,
  production build, Go vet/race tests, and Compose configuration passed.
- The staged feature, excluding the pre-existing season-progress work, also
  passed format, lint, strict typecheck, all 179 tests, and production build.
- Regression coverage includes ongoing manga/anime/series with no completions,
  all-status recorded progress, completed-only known-total fallback without
  mutation, shared filtering with unchanged completed-only genres, and partial
  watch-time labels. Existing favorites keyboard/edit/expand and independent 3×3
  tests continue to pass.
- Read-only inspection of the local Library confirmed both legacy missing
  progress with known totals and missing runtimes. Missing durations and unknown
  reading/game time remain explicitly unavailable rather than fabricated.
- The browser tool still reports that Chromium/Google Chrome is not installed.
  Compact cover sizing, 320 px/tablet/desktop/200% zoom, and real-artwork layout
  remain visually unverified; no dependency was installed.

### Executed checks for the simplified presentation (2026-11-03)

- Repository format, lint, strict typecheck, all 187 workspace frontend tests,
  production build, Go vet/race tests, and Compose configuration passed.
- The staged feature, excluding the previous season-progress work, also passed
  format, lint, strict typecheck, all 182 tests, and production build.
- The 38 focused Consumption/Overview/favorites/3×3 tests passed. Coverage includes
  collapsed calculation notes, Tab reachability and pointer expand/collapse,
  positive partial chapter/game totals, explicit unknown time, unchanged shared
  filtering, and preserved favorites editing/preview/3×3 behavior.
- Consumption/genre calculation modules and backend files are unchanged. The
  presentation still includes ongoing progress and completed known-total fallbacks.
- Real-browser cover wrapping, artwork, 320 px/tablet/desktop/200% zoom, and native
  summary-key activation remain pending because no browser is available. No
  dependency or custom keyboard workaround was introduced.

### Executed checks for the compact list without Details (2026-11-03)

- Repository format, lint, strict typecheck, all 193 workspace frontend tests,
  production build, Go vet/race tests, and Compose configuration passed.
- The staged feature, excluding the previous season-progress work, also passed
  format, lint, strict typecheck, all 188 tests, and production build.
- Component coverage verifies complete removal of Details and its note regions,
  inline singular/plural units for all six numeric media types, shared filtering,
  ongoing and inferred completed progress, explicit unknown/untracked values,
  and positive partial episode/chapter/game-time totals. Calculation modules and
  backend files are unchanged.
- Simultaneous full/staged runs exceeded existing 5-second limits in unrelated
  tests. Both sequential reruns passed without changing test timeouts or
  assertions; the execution constraint is recorded in the validation guideline.
- Real-browser row wrapping, right alignment, long labels/large counters,
  320 px/tablet/desktop/200% zoom, and screen-reader output remain unverified
  because no browser is available. No dependency was installed.

### Overview review (2026-11-10)

The previously reported uniform `1%` state was not captured in the inspected
running/source builds, so this review does not identify a numeric root cause for
that earlier state. The existing `count / completedCount * 100` calculation and
completed-only denominator remain unchanged. The legend now exposes its supporting
counts, and percentage labels cannot wrap into misleading fragments.

Real Chrome checks used synthetic data, including overlapping genres, missing
metadata, common and sub-1% genres, long labels, all-type and per-type filters,
ongoing consumption, empty categories, initial loading, and failed refreshes.
Component checks covered 320 px, tablet, desktop, and a 200%-equivalent viewport
(720 CSS px at device scale 2), plus native keyboard scrolling. An isolated full
application/backend run verified favorites retained during a pending/failed
navigation refresh, retry recovery, keyboard navigation into a favorite, and the
320 px Overview. No owner data or running installation was changed.

See [Overview behavior](overview-favorites.md) for retained-data and mutation
boundaries. Screen-reader speech output remains unverified; browser roles,
accessible controls, and keyboard behavior were inspected.

Validation passed after this review: frontend formatting, lint, strict typecheck,
all 221 frontend tests (one worker, without a competing suite), production build,
Go vet/race tests and formatting, and Docker Compose configuration. The new
regressions cover confirmed metrics/activity during refresh and readable cached
favorites with stale editing blocked until recovery.
