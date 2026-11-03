# Installation-wide start page

## Scope and plan

The owner chose an installation-wide preference rather than browser storage.
Settings offers Overview (the existing default), Library, Monthly Log, and
Activity. Saving changes the next opening at the root URL, not the current page.
Explicit hashes, OAuth query parameters, reloads, and back/forward navigation
keep their existing meaning. No dependency or deployment setting is added.

1. Add a strict, bounded GET/PUT `/api/preferences` contract owned by the store.
2. Upgrade SQLite schema 5 to 6 transactionally and introduce JSON backup version
   11 with `preferences.startPage`. Older supported snapshots default to Overview.
3. Add an accessible Settings card with explicit Save, loading/error/retry states,
   and no optimistic confirmation. Resolve the root asynchronously, without
   replacing an explicit route chosen while the request is pending.
4. Test upgrade/restart, invalid input, concurrency, persistence/DDL rollback,
   backup/restore, keyboard interaction, and route preservation; run the complete
   validation contract.

## API and interface

- `GET /api/preferences` returns `{"startPage":"overview"}` (or the saved choice).
- `PUT /api/preferences` accepts the same shape with `overview`, `library`,
  `monthly_log`, or `activity`. It rejects unknown fields, trailing JSON, and
  bodies over 1 KiB. Invalid choices return 422; failed persistence returns 500
  without changing memory or SQLite. The response confirms the committed choice.
- Both endpoints use existing installation authentication and `Cache-Control:
  no-store`. The frontend uses same-origin, cancelable requests, not browser
  storage. No collection or provider data is sent with preference writes.
- Settings saves explicitly and stays on Settings. Loading failures offer retry;
  save failures retain the selected value. Restoring a backup refreshes the card.
- The root shows a loading state while resolving the preference, then replaces
  its history entry with the canonical tab hash. A failed read falls back to
  Overview with an accessible notice, without blocking Library access. Explicit
  navigation cancels pending startup work and late responses are ignored.

## Compatibility and rollback

Schema 6 adds a singleton `app_preferences` table and widens the metadata JSON
version constraint to 11. Collection tables, IDs, ordered selections, images,
Activity, counters, and AniList jobs remain unchanged. Migration creates the
Overview preference in the same transaction as the schema/version change. A
failed migration leaves schema 5 and its data intact. Restoring versions 1–10
resets the preference to Overview; version 11 restores its saved choice. Invalid
preferences are rejected, not silently repaired.

Older binaries do not support schema 6 or JSON 11. Before any separately
authorized update, retain a pre-update portable backup and a stopped-volume
copy. To roll back, stop the backend, preserve the current volume and a fresh
version-11 export, then restore the matching pre-update volume/image. Subsequent
writes remain available only in that preserved current backup; do not edit
version numbers or drop fields to manufacture an older format. Source changes
and synthetic tests do not authorize an update or migration of the real instance.

## Manual verification

Using synthetic data, save each option, open the root in another browser, and
reload. Check that the chosen tab is active and its canonical hash is present.
Change the choice without leaving Settings; confirm direct Overview, Library,
Monthly Log, Activity, search, detail, and Settings URLs still open as requested.
Check back/forward, slow/failed preference requests, keyboard focus and native
select interaction, 320 px/tablet/desktop layout, and 200% zoom. After restoring a
backup, confirm Settings reloads the restored preference without navigating away.

## Executed validation (2026-11-03)

- Frontend format, lint, strict typecheck, all 218 workspace tests, and production
  build passed. The isolated staged feature, excluding the earlier season-progress
  changes, also passed those checks, all 213 tests, and its production build.
  The two full frontend suites ran sequentially.
- Go format/vet/race tests and a CGO-disabled backend build passed for the final
  staged source. Tests cover all supported choices, cross-client reads, legacy
  defaults, restart, complete backup/restore, preserved unrelated collection state,
  invalid/bounded requests, authentication/cache policy, concurrent reads/writes,
  failed-write rollback, and schema-5 upgrade/failed-DDL rollback.
- The 25 new frontend tests cover the typed API boundary, explicit keyboard save,
  loading/error/retry, pending-write controls, cancellation/late responses, each
  root choice, query/history preservation, direct-route reload, back/forward,
  fallback with retained data, and refresh after restore.
- Compose configuration and whitespace checks passed. No dependency, image,
  environment, running service, or production-data change was made.
- Real-browser layout, native-select appearance, 320 px/tablet/desktop/200% zoom,
  and screen-reader output remain unverified: the browser tool reports that
  Chromium/Google Chrome is not installed. No dependency was installed.
