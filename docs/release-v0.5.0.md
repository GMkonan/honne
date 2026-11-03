# Honne v0.5.0

This release brings durable SQLite storage and a more personal Library Overview.

## Highlights

- SQLite is now the operational store. Existing supported JSON data is imported
  on first startup without changing the original source file. Collection changes,
  Activity, counters, and AniList jobs share one transaction and rollback boundary.
- Download portable JSON backups and preview/restore them from Settings. A restore
  replaces the destination collection; it does not merge two Libraries.
- Upload a custom Library banner and profile picture, with independent reset
  actions. Both are persisted and included in portable backups.
- Overview combines collection metrics, recent local Activity, favorites, genre
  statistics, and consumption. Filter statistics by media type; consumption counts
  recorded progress across statuses rather than only completed entries.
- Choose and order favorites through a visual gallery. Favorites are not limited
  to nine per media type; the independent 3×3 selection remains limited to nine
  and exports as a local PNG.
- Set sequential completed seasons for TMDB series to fill watched episodes.
  Specials, gaps, ongoing seasons, and unconfirmed completion are excluded.
  Manual episode editing and the entry's status remain unchanged.
- Choose Overview, Library, Monthly Log, or Activity as the installation-wide start
  page. Explicit URLs, reloads, and back/forward navigation keep their meaning.
- Global catalog search avoids unnecessary provider requests and preserves partial
  results when an independent catalog is unavailable.

Hosted demos and social activity are roadmap ideas only, not features shipped in
this release. Private installations remain private by default.

## Important upgrade information

The current contracts are **SQLite schema 6** and **portable JSON version 11**.
Older supported snapshots, including v0.4.0's JSON data, migrate forward. Existing
favorites initialize the independent 3×3 selection without changing their order;
older backups default the start page to Overview.

Before updating either a source or release installation:

1. Download and validate a portable backup from the running installation.
2. Preserve its Compose files, private `.env`, and exact current image IDs/tags.
3. Stop the backend before copying the complete data volume. Keep that copy
   private: unlike a portable export, it can contain AniList OAuth credentials.
4. Update backend and frontend together to the same v0.5.0 release. Preserve the
   configured volume name, port, origin, and provider/OAuth settings; do not replace
   an existing `.env` with `env.example`.
5. Confirm health, Library/Activity counts, selections, preferences, and a fresh
   version-11 backup before removing any recovery artifacts.

The frozen legacy `media.json` is only the pre-migration recovery point. After new
SQLite writes it is not a current copy of the collection.

## Rollback

Do not downgrade by changing image tags alone. An older binary cannot be assumed
to understand the new SQLite or portable JSON format.

Stop the updated backend, preserve its current volume and a fresh version-11
export, restore the matching pre-update volume/configuration, and start the exact
previous images. This returns to the pre-update recovery point; subsequent writes
remain only in the preserved updated volume/export. Never edit version numbers or
drop fields to manufacture an older backup.

## Moving data to another installation

Update the destination to v0.5.0 first, back up its current state, and disconnect
AniList there before restoring the source JSON through Settings. The entire
destination collection is replaced. Portable backups exclude OAuth authorization;
reconnect only the intended AniList account after verifying the restored data.
Server-only provider credentials, origin, port, and other deployment settings stay
in the destination's configuration.

## Validation and remaining limits

Release publication is gated by Go formatting/vet/race tests, frontend formatting,
lint, strict typecheck, automated tests and production build, and both Compose
configurations. Image publication covers Linux amd64 and arm64.

Real-browser responsive/200%-zoom inspection, native-select appearance, actual PNG
inspection, and screen-reader output remain unverified because no browser is
installed in the validation environment. Automated interaction and accessibility
behavior tests do not replace those manual checks.

See [self-hosting](self-hosting.md), [SQLite migration](development/sqlite-migration.md),
and [start-page compatibility](development/start-page.md) for operational details.
