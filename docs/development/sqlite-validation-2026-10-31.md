# SQLite validation — 2026-10-31

## Scope and conclusion

The local source passed the persistence and isolated container checks below.
No storage defect was found in the exercised scenarios. This is not approval to
update the owner's installation or publish a release: the roadmap's desktop,
mobile, and 200% zoom visual gate remains outstanding.

All fixtures were synthetic. The running installation, its volumes, credentials,
and collection were not used or changed. No provider calls were enabled.
The validation adds tests and clarifies recovery documentation; it does not
change the storage implementation or schema.

## Automated checks

- Go formatting, `go vet ./...`, and uncached `go test -race -count=1 ./...`
  passed: 135 top-level tests, 184 cases including subtests. Of those cases, 56
  have SQLite-specific test names.
- Frontend formatting, lint, strict type checking, all 84 tests, and production
  build passed, including the existing uncommitted season-progress work.
- Docker Compose configuration passed with no credentials loaded.
- `CGO_ENABLED=0` backend builds passed for `linux/amd64` and `linux/arm64`.
- Both source Dockerfiles built successfully; the isolated amd64 backend and
  frontend containers became healthy.
- `git diff --check` passed.

The persistent regression tests added in `backend/sqlite_validation_test.go`
exercise:

1. migrating a nonempty legacy array and each JSON snapshot version 1–8 through
   the runtime entry point, reopening the database, preserving IDs and notes,
   and verifying that the source bytes never change;
2. exporting backups before and after banner, avatar, and ordered-favorites
   changes, restoring both backups into fresh SQLite stores, and reopening each
   store with byte-identical logical exports, including Activity, counters, and
   an account-bound pending delete job;
3. injecting a SQLite trigger failure at the final appearance insertion, after
   all other tables have been replaced, and checking complete in-memory and
   durable rollback for restore, media deletion, and favorite replacement;
4. failing a schema-2 upgrade after DDL has begun and verifying that the metadata
   table, JSON version, schema version, and database integrity are unchanged.

Existing tests also passed for schema 1 → 3 and 2 → 3 upgrades, source/destination
protection, malformed snapshots, corruption, counters, transaction failures,
AniList ownership/generation safety, restore confirmation, and shutdown.

To rerun the focused persistence checks from the repository root:

```bash
(cd backend && go test -race -count=1 -run 'SQLite|Backup|Custom|Favorites' ./...)
```

Use `docs/agents/validation.md` for the complete repository validation contract.

## Isolated container rehearsal

The rehearsal used Compose project `honne-sqlite-validation`, host port
`127.0.0.1:17417`, and a workspace-local synthetic data bind mount. It did not
load the owner's `.env`. Provider URLs pointed to an unavailable loopback port,
and no OAuth credentials were supplied. Local artifacts are retained under
`.opencode/sqlite-validation-20261031/`, which is ignored by Git.
The temporary containers and their network were removed after the rehearsal;
the synthetic data and backups were retained.

Observed results:

- A JSON-v6 collection with nine mixed-media titles migrated to SQLite schema 3.
- Real HTTP backup, preview, and confirmed restore endpoints round-tripped the
  complete snapshot before and after uploading generated 1920 × 520 and
  512 × 512 PNG images and setting nine favorites in reverse order.
- Stopping the backend and copying its database produced a readable operational
  backup with `integrity_check = ok`, no `foreign_key_check` violations, nine
  media rows, the expected favorite order, and mode `0600`.
- Restarting the isolated backend retained an identical latest JSON export.
  The legacy JSON's SHA-256 still matched the pre-rehearsal source.
- An already-local v0.4.0 JSON-only image, run with networking disabled and a
  read-only copy of the current export, exited with
  `unsupported data file version 8`. The snapshot remained unchanged.

## Recovery documentation correction

The prior rollback wording could be read as allowing any older JSON-only image
to consume the latest SQLite export. The current export is JSON version 8;
being JSON is not sufficient for compatibility. `docs/self-hosting.md` and
`sqlite-migration.md` now require either a binary supporting that contract or a
matching pre-update backup/volume. The latter restores an earlier recovery
point; it does not automatically retain post-update changes in the running
collection. The latest export must still be preserved separately.

The retained JSON writer in current source only proves compatibility with
current source, not with an older published release.

## Outstanding gates and limits

- Browser validation was attempted but blocked because Chromium/Google Chrome
  was not installed for the browser tool. No browser dependency was installed.
  Desktop, 320 px, tablet, 200% zoom, image cropping/contrast, and real-browser
  keyboard checks remain unvalidated.
- ARM64 was cross-compiled, not run on ARM hardware or validated as an ARM
  container image.
- The rehearsal covered graceful stop/restart and transactional write failures,
  not physical power loss, disk exhaustion, or hardware/filesystem faults.
- No production migration, external-provider write, push, release, or deployment
  was performed. These remain separate owner-authorized actions.
