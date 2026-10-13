# SQLite migration — implementation and activation gate

Owner request: prioritize SQLite persistence now (2026-10-11), instead of waiting for the 3×3 feature. Preparation and the synthetic migration path now live on local `main`; runtime activation and owner-data migration remain separate approval gates.

## Current evidence

The Go backend uses a version-6 JSON snapshot. `store` owns the mutex, collection, Activity (currently capped at 500), AniList outbox and monotonic counters. OAuth credentials are stored separately. Logical JSON downloads use the same snapshot. The runtime image builds with `CGO_ENABLED=0`.

Preparation extracts the existing persistence concern from `main.go` into `store.go`, without changing serialization, file paths, HTTP contracts or writes. The real `backend/data/media.json` is not opened for migration or changed.

## Driver decision

The approved implementation uses **modernc.org/sqlite v1.60.1**, a BSD-3-Clause, pure-Go `database/sql` driver whose module targets Go 1.26. It preserves the non-CGO build and is pinned in `go.mod`/`go.sum`, at the cost of a larger transitive dependency tree. `mattn/go-sqlite3` was not selected because it would require CGO and build/runtime changes. The application does not shell out to a SQLite CLI.

Selecting the driver does not authorize runtime activation, deployment changes or migration of owner data.

## Delivery slices

1. **Preparation — complete locally:** store persistence is isolated, invariants and rollback are documented, and bounded JSON preflight covers versions 1–6.
2. **Transactional importer — complete locally:** the pinned driver creates a new versioned database exclusively, imports media, Activity, AniList outbox and counters in one transaction, runs `integrity_check`, closes/reopens, verifies logical equality, restricts permissions and syncs the destination directory. Tables retain complete payloads and positions without cascading history/tombstone loss.
3. **Runtime store — next:** add concrete SQLite-backed persistence while keeping one store authority and the current in-memory domain behavior. Every domain mutation must atomically persist items, Activity, counters and outbox with complete in-memory rollback on failure. SQL-native query optimization is a separate measured task.
4. **Activation and operations — gated:** add graceful server/worker shutdown and database close; update configuration, Docker and volume documentation; rehearse on synthetic and disposable copied data; preserve logical JSON backup/rollback. Owner-authorized real migration only after those checks.

## Atomicity and durability

Each domain operation must commit items, Activity, counters and outbox as one transaction. On failure restore the complete in-memory pre-operation state; never return success before commit. Use foreign keys only where compatible with retained historical references, a bounded busy timeout and durable SQLite settings. Review WAL versus rollback-journal explicitly; if WAL is used, raw file backup must include a checkpoint or SQLite online-backup strategy, not a live `.db` copy. Set restrictive file/volume permissions. Close connections on shutdown.

Existing JSON writes currently use a temp-file rename but do not perform the file/directory `fsync` required by `backend/GUIDELINES.md`; do not claim their current behavior guarantees power-loss durability. SQLite transaction durability is part of the migration acceptance bar, not an excuse to weaken the JSON contract.

## Backup and rollback

- Maintain the logical versioned JSON export as a portable owner-readable backup; exclude OAuth credentials as today.
- Keep the original JSON source immutable. It is a pre-migration recovery point, **not** a current backup after SQLite receives new writes.
- Before rollback: stop the service and AniList worker, export the latest SQLite state to a legacy-readable snapshot and validate reopening it with the previous binary in isolation. Restoring only the original source loses post-migration writes; communicate this explicitly.
- Treat pending remote jobs carefully: preserve IDs, generation, account binding and tombstones, and never replay against another account. Do not start providers during a migration rehearsal.
- Do not delete sources, change production Compose, run a real migration or release automatically.

## Acceptance tests for the implementation

Use `t.TempDir`, synthetic fixtures and no external providers:

- Legacy array and supported versioned snapshots → SQLite → close/reopen → logically identical JSON export.
- Planned revisits, platform arrays, notes/metadata, Activity, pending jobs and tombstones preserved; arrays remain `[]`.
- Reconstructed counters consider deleted IDs referenced by jobs/history; IDs are not reused.
- Empty, corrupt, unsupported and duplicate-ID sources; pre-existing destination; interruption/failed commit; repeated import cannot duplicate data.
- Full in-memory rollback on failed transaction, atomic outbox/activity writes, concurrent readers/writers with `go test -race`.
- Busy/read-only/corrupt database fails clearly, unsupported schema fails startup, shutdown closes resources.
- Old application opens a latest-state rollback export, without losing post-migration changes.
- CGO-disabled Docker build and volume permissions; normal API/backup contracts and frontend validations remain passing.

The transactional JSON-to-SQLite importer is implemented and tested, but SQLite is **not the runtime store and is not activated**.

## Implemented migration safeguards

The bounded preflight supports legacy arrays and JSON versions 1–6; validates IDs/counters, rejects unknown fields, corruption, trailing data and existing destinations, computes the source SHA-256, normalizes platform arrays and retains all Activity/outbox payloads. Deleted IDs referenced only by Activity or jobs contribute to counters.

The importer rechecks that digest after exclusively creating the destination, removes incomplete database artifacts on failure, uses `DELETE` journal mode with `synchronous=FULL`, commits the complete snapshot in one transaction and validates `PRAGMA integrity_check`. Readback rejects unsupported schemas, malformed payloads, non-contiguous positions and counters inconsistent with retained IDs. A logical JSON export can be reopened by the existing JSON store. No provider is contacted, source written, runtime switched or owner data opened.

### Runtime activation blockers found during review

Existing AniList paths still discard some `persistLocked` errors. Before SQLite activation, audit every mutation/worker for full-state rollback and error propagation; do not simply replace the persistence function and declare atomic durable operations. The runtime server also needs owned shutdown/worker termination and DB close. These issues are not resolved by the preflight or draft schema.
