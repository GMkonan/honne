# SQLite runtime and JSON migration

Owner request: prioritize SQLite persistence now (2026-10-11). The runtime implementation and activation are complete on local `main`; deployment and migration of the owner's real data still require a separately authorized release/update.

## Runtime model

The Go backend keeps one in-memory `store` as the authority for locking, collection state, Activity (capped at 500), AniList outbox, and monotonic counters. SQLite is the operational durable store. Every successful domain mutation replaces the complete logical snapshot inside one SQLite transaction, so media, Activity, counters, and outbox commit together. SQL-native querying is intentionally deferred until measurements justify it.

The implementation uses **modernc.org/sqlite v1.60.1**, a pinned BSD-3-Clause pure-Go driver compatible with the existing Go 1.26 and `CGO_ENABLED=0` image. The runtime uses `foreign_keys=ON`, a five-second busy timeout, `synchronous=FULL`, and `DELETE` journal mode. DELETE mode is deliberate for this single-instance application: readers use the in-memory store, and stopped-volume backups do not need a WAL checkpoint or live sidecar handling.

`SQLITE_PATH` defaults to `data/honne.db`. `DATA_PATH` defaults to `data/media.json` and now identifies only the legacy JSON source used during first activation. The two paths must differ.

## First-start activation

At startup:

1. if `honne.db` exists, the backend transactionally upgrades schema version 1 through version 3 when needed, validates its integrity, payloads, positions, counters, and opens it as the runtime store;
2. if the database is absent and a non-empty legacy `media.json` exists, the backend validates JSON versions 1–8, creates the database exclusively, imports the complete snapshot transactionally, closes/reopens it, verifies logical equality, and leaves `media.json` unchanged;
3. if neither store exists, or the legacy source is empty, the backend creates an empty versioned database.

A failed migration removes incomplete database and journal artifacts and does not change the JSON source. A pre-existing destination is never overwritten. Once SQLite receives new writes, the frozen legacy JSON is only a pre-migration recovery point and is no longer a current backup.

## Preserved data and validation

Migration and runtime persistence preserve:

- media IDs and monotonic counters, including deleted IDs referenced by Activity or jobs;
- collection metadata, notes, platforms, planned revisits, and empty-array contracts;
- manually ordered favorites, the local custom Library banner, and the custom profile picture;
- Activity order and payloads;
- AniList jobs, generation, account ownership, retry state, and tombstone references.

The importer bounds input at 32 MiB, rejects unknown fields, unsupported versions, corruption, trailing JSON, invalid or duplicate IDs, and inconsistent counters. It records and rechecks the source SHA-256 before import. SQLite startup runs `integrity_check` and rejects unsupported schema versions or malformed payloads.

## Durability and shutdown

Runtime writes use one SQLite transaction and report failures to the domain operation, whose in-memory mutation is rolled back. AniList worker transitions no longer discard persistence errors; failed state changes restore the prior in-memory snapshot and stop that worker pass instead of claiming success.

The HTTP server owns explicit read/header/write/idle timeouts. On `SIGINT` or `SIGTERM`, it stops accepting requests, gives active handlers up to ten seconds to finish, cancels and joins the AniList worker, then closes the database. OAuth authorization writes and the retained JSON writer use synced temporary files, atomic rename, and parent-directory sync.

## Backup, restore, and rollback

- **Portable backup:** `GET /api/backup` exports the current logical versioned JSON snapshot, including ordered favorites, the local Library banner, and the profile picture, and excludes OAuth credentials.
- **In-app restore:** Settings uploads the raw JSON to `POST /api/backup/preview`, shows validated counts, then sends the confirmed file to `POST /api/backup/restore`. Restore requires an explicit confirmation header and a disconnected AniList integration. The 32 MiB bounded input is decoded strictly, any in-flight AniList worker pass is joined, and Library, Activity, counters, favorites, appearance, and outbox are then replaced in one SQLite transaction, with in-memory rollback on persistence failure.
- **Operational backup:** stop the backend before copying `/data`; the directory contains `honne.db`, the frozen legacy source when upgraded, and the separate AniList authorization file.
- **Volume restore:** stop the backend, preserve `/data`, remove or move the current `honne.db`, place the downloaded snapshot at `/data/media.json`, and start the current backend. It imports that snapshot into a new database.
- **Rollback to a JSON-only binary:** while the SQLite version is still available, download a fresh portable backup. Stop the backend, preserve `/data`, place that latest export at `/data/media.json`, then start the older binary. Restoring only the frozen migration source loses every post-migration write.

Pending remote jobs remain account-bound. Never run two backend instances against the same volume, and never rehearse migration with real provider calls enabled.

## Automated evidence

Synthetic tests cover import and logical JSON round-trip, immutable sources, fresh databases, runtime write/restart, current-state backup, in-app preview and restore, confirmation and disconnected-account gates, destination exclusivity, invalid counters and corruption, failed transaction atomicity, close behavior, worker persistence rollback, and graceful cancellation. The complete release gate remains Go format/vet/race tests, frontend format/lint/typecheck/tests/build, Compose validation, a CGO-disabled backend build, and Docker image construction.

No owner data is migrated by these source changes alone. A push, release, deployment, or restart of the real installation remains a separate authorized action.
