# Overview, favorites, and 3×3

Owner decisions (2026-11-02): Library opens on Overview; its sibling list tab is
named Library, not Collection. Overview combines a collection summary, recent
local activity, and favorites. Favorites use media-type tabs, four portrait
columns, an initial eight-cover preview, Show more, and visual editing. No
social features, character catalog, or public profile are introduced.

Favorites occupy the larger Overview column, between At a glance and recent
activity. The smaller column contains separate read-only
[genre and consumption statistics](genre-stats.md) cards. A shared media-type
filter controls statistics only; favorites retain their independent category tabs.

On the Library list, media-type filters sit above status in the right sidebar as
compact vertical artwork strips. On narrow screens the sidebar precedes the
collection. Source order follows media type, status, then collection controls,
preserving keyboard order at both layouts. Media type, status, search, sorting,
and Clear filters retain their previous combined behavior. Cover previews reuse
the existing HTTP(S)-only, credential-free URL validation.

## Independent selections

Favorites may contain any number of unique current Library titles. The 3×3 is
a separately ordered subset of favorites, with at most nine per media type.
Changing 3×3 selection or order does not change favorites. Removing a favorite
also removes it from the 3×3 in the same transaction. Deleting a Library entry
cleans both selections. The existing image renderer remains local.

## Persistence plan and compatibility

SQLite schema 5 removes the favorite-position upper bound and adds `top_nine`,
which references favorites. JSON snapshot 10 adds `topNineMediaIds`. The schema-4
upgrade rebuilds favorites and store metadata and initializes top nine from the
old selection in one transaction, retaining IDs and order. Older supported
SQLite schemas still follow the existing upgrade chain. JSON versions 1–9
initialize the independent top nine from their validated former favorites;
version 10 preserves an explicitly empty top nine without repopulating it.

Favorites remain bounded by the current Library and a bounded HTTP request;
there is no nine-title product limit. Both selections reject duplicates and
missing IDs; top nine additionally validates category counts and membership.
Writes, restore, cleanup, and in-memory rollback include both selections.

Before deployment, retain a portable pre-update backup and a stopped-backend
copy of `/data`, plus the matching old images. Older binaries reject schema 5
and JSON 10. Rollback therefore requires stopping the backend, preserving any
newer data separately, and restoring the matching pre-update data and images;
never edit version numbers or discard favorites to force compatibility. Source
changes do not authorize deployment or remote delivery.

## Validation

Cover migration from schemas 1–4, failed-upgrade rollback, legacy JSON import,
favorites beyond nine, independent 3×3 selection/order, membership and limits,
restart, backup/restore, deletion, and failed-write rollback. Frontend coverage
includes Overview deep links and navigation, summary and activity states,
category tabs, expand/collapse, visual editing, and 3×3 export. Validate keyboard
operation, modal focus, 320 px/mobile/tablet/desktop, and 200% zoom manually when
a real browser is available. Run the complete repository validation contract.

## Executed validation (2026-11-02)

- Go format, vet, race tests, and a CGO-disabled backend build passed.
- Frontend format, lint, strict typecheck, all 133 workspace tests, and Vite build passed.
- The staged feature was also checked independently, without the pre-existing
  uncommitted season-progress changes: lint, typecheck, 128 frontend tests, and build passed.
- Compose configuration and both Docker image builds passed. Validation images
  use separate tags; image construction alone does not update the live service.
- An isolated backend container, with no published ports or external networking,
  upgraded a synthetic schema-4 database to schema 5, retained the old top nine,
  accepted twelve same-type favorites, validated independent 3×3 order and limits,
  cleaned removed favorites/deleted titles, and retained the snapshot after restart.
- A stopped post-rehearsal database passed SQLite integrity checking. The
  rehearsal container was removed; synthetic recovery artifacts remain ignored.
- Real-browser layout and actual PNG inspection remain outstanding because the
  browser tool reports Chromium/Google Chrome is not installed. No dependency was added.
