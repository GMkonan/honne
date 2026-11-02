# Product roadmap

This document records the owner's current priority order. It is a planning guide rather than a release commitment. Pushes, releases, deployments, and migration of the owner's production data require explicit authorization.

## 1. Stabilize and deliver the local persistence release

The local `main` now contains the operational SQLite store, non-destructive JSON migration, graceful shutdown, portable backup restore, custom Library images, and the first favorites slice. Before remote delivery:

- visually validate the current source build at desktop, mobile, and 200% zoom;
- rehearse SQLite schema upgrades through version 5 using synthetic data;
- verify a JSON backup before and after banner/profile-picture/favorites changes;
- review release and rollback notes as one coherent upgrade path;
- split or retain the local commits so migration, restore, customization, and documentation remain reviewable;
- only then push and prepare the next release after owner approval.

The running release installation and real owner data must remain unchanged during this validation.

## 2. Validate the Library Overview and independent 3×3

The local source implementation now supports:

- Overview as the initial Library page, with sibling tabs named Library and Monthly Log;
- collection metrics and the eight newest local Activity events, preserving independent successful loads;
- a completed-only genre donut with media-type tabs, recorded consumption, and explicitly partial watch-time estimates above favorites;
- favorites without a nine-title product limit, using category tabs, a four-column cover preview, and Show more/less;
- visual selection and manual ordering from Overview, not Settings;
- a separately persisted 3×3 selection, chosen only from favorites, with up to nine per media type;
- local PNG export from the confirmed 3×3 order rather than the full favorites list;
- schema-5/JSON-10 migration preserving previous choices, portable backup/restore, deletion cleanup, and rollback.

Next refinements:

- visually validate Overview, category tabs, pickers, and mobile/200% zoom presentation with real artwork;
- visually validate the genre card with long/many genres, missing metadata, keyboard scrolling, and partial consumption estimates;
- visually validate full/partial PNG grids, long titles, missing covers, and crop/contrast;
- keep favorites separate from Monthly Log history, social features, and any future public profile;
- update a running installation only after explicit authorization and matching pre-update backups.

## 3. Validate Library personalization

The local personalization implementation accepts a Library banner up to 8 MiB and a profile picture up to 4 MiB from Settings, stores both in SQLite, includes them in JSON backups, and restores their configured defaults independently. Settings recommends 1920 × 520 px for banners and 512 × 512 px for profile pictures without previewing the bundled default banner.

Remaining work:

- validate contrast and responsive cropping against bright, dark, portrait, landscape, and animated images;
- decide whether crop positioning needs an owner-controlled focal point;
- keep remote image URLs out of the first version unless there is a concrete need.

## 4. Refine Monthly Log

- Replace the current prominent Library entry point with a compact, better-positioned action.
- Remove the oversized decorative mark from the Monthly Log heading.
- Align and refine the media-type selector.
- Visually validate exports with up to 15 titles, 16–30 titles, and more than 30 titles.
- Keep detailed cards for up to 15 titles, switch denser logs to cover-only artwork, and identify titles omitted beyond the image limit.

Monthly Log is chronological and remains separate from manually curated favorites.

## 5. Refine planned revisits and Edit Library actions

- Replace the prominent planned-repeat edit control with a simpler option while preserving type-aware rewatch/reread/replay language.
- Keep the Library-card repeat marker visually secondary to primary status.
- Establish clear primary, secondary, tertiary, and destructive action hierarchy in Edit Library.
- Keep `Save changes` primary and make cancel, title editing, and removal compact and intentional.

## 6. Reassess the deferred frontend refactor

Review issue #9 and the unintegrated `issue-10` work before resuming it. Prioritize extraction from `App.tsx`, typed API services, stable non-hash routes, accessible shared primitives, and reusable page boundaries. Do not resume Zustand, React Router, or Tailwind migration without a current, concrete benefit.

## 7. Define an optional public profile

A public projection must remain opt-in, expose only explicitly selected data, avoid publishing private management capabilities, and keep Honne private by default. Favorites may feed it later, but Library favorites and their PNG exports must not imply publication.

## 8. Internationalize with Weblate

Prepare first-party interface copy, accessibility labels, validation messages, and user-facing backend errors for translation. Define source language, fallback, catalog format, pluralization, date formatting, and the Weblate review workflow before implementation.

## 9. Documentation and repository cleanup

- Keep `README.md`, `DIAGRAMS.MD`, self-hosting, migration, and API documentation aligned with released behavior.
- Audit `AGENTS.md`, `docs/agents/`, module guidelines, and stale workflow notes without removing enduring engineering rules.
- Keep the repository understandable to its owner without adding process ceremony.

## Outside the current sequence

Ideas such as a separate Cartoon or Animation category (#67), broader personal metrics beyond the completed-only genre card (#34), upcoming releases (#33), offline support (#59), and public sharing remain valid but are not part of the current delivery sequence.
