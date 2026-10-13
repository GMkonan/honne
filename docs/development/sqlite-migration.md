# SQLite migration — preparation and approval gate

Owner request: prioritize SQLite persistence now (2026-10-11), instead of waiting for the 3×3 feature. This is a local preparation branch, not a released migration.

## Current evidence

The Go backend uses a version-6 JSON snapshot. `store` owns the mutex, collection, Activity (currently capped at 500), AniList outbox and monotonic counters. OAuth credentials are stored separately. Logical JSON downloads use the same snapshot. The runtime image builds with `CGO_ENABLED=0`.

Preparation extracts the existing persistence concern from `main.go` into `store.go`, without changing serialization, file paths, HTTP contracts or writes. The real `backend/data/media.json` is not opened for migration or changed.

## Decision requiring owner approval

Proposed dependency: **modernc.org/sqlite**, a pure-Go `database/sql` driver. Pin a reviewed, Go-1.26-compatible version and commit `go.sum` after approval. It preserves the current non-CGO Docker build, but brings a larger dependency tree. Alternative: `mattn/go-sqlite3`, requiring CGO, a C toolchain and runtime/build changes. Do not shell out to a SQLite CLI as the application persistence layer.

No driver has been added or downloaded. Driver choice, migration activation and rollback behavior must be reviewed before implementation.

## Proposed delivery slices

1. **Preparation (this branch):** isolate store persistence, inventory invariants, define safety/rollback and run existing restart/concurrency tests.
2. **Driver + transactional store:** versioned SQLite schema and concrete storage functions; keep one store authority, not a generic repository framework. Tables for media, activities, sync jobs and counters; preserve full payloads and supported metadata. Keep tombstoned job/activity media references even after deleting a title; do not add cascading deletes that lose them. Initially keep in-memory domain behavior and transactional durable writes to minimize API changes; SQL-native query optimization is a separate measured task.
3. **Migration + activation:** explicitly import a supported JSON snapshot into a new database, transactionally, validating IDs, all counters, arrays, metadata, Activity and outbox. Use exclusive process ownership; never run old and new writers together. Reject corrupt/unsupported sources and existing non-empty destinations rather than guessing or merging. Preserve the source byte-for-byte. Validate a close/reopen round trip and SQLite integrity before switching deployment configuration.
4. **Operational delivery:** update Docker copy of `go.mod`/`go.sum`, env examples, volume/config paths, documentation and JSON backup compatibility. Owner-authorized real migration only after backup and rehearsal on a disposable copy.

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

SQLite migration is **not implemented or activated** in this slice.

## Continued local preparation (owner approved continuation)

Added a bounded, read-only migration preflight and a draft schema. Preflight supports legacy arrays and JSON versions 1–6; validates IDs/counters, rejects unknown fields/corruption/trailing data and existing destinations, computes the original source SHA-256, normalizes platform arrays and retains all Activity/outbox payloads. Deleted IDs referenced only by Activity or jobs contribute to counters. No provider is contacted, destination created, source written, or runtime switched. The future migrator must recheck the digest and use exclusive destination creation; a successful preflight is not a migration or a concurrency guarantee. Draft tables preserve complete payloads plus positions, avoiding cascading history/tombstone loss.

Driver approval remains explicit under repository policy: **may we add `modernc.org/sqlite` pinned to a reviewed version?** No dependency added in this slice. After approval: transactional import/write/read, failure rollback, restart/integrity/concurrency tests, graceful close, then rehearsal on synthetic/copy data. Real owner data and deployment remain untouched.

### Runtime activation blockers found during review

Existing AniList paths still discard some `persistLocked` errors. Before SQLite activation, audit every mutation/worker for full-state rollback and error propagation; do not simply replace the persistence function and declare atomic durable operations. The runtime server also needs owned shutdown/worker termination and DB close. These issues are not resolved by the preflight or draft schema.
