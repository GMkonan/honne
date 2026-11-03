# Product roadmap

This document records the owner's current priority order. It is a planning guide rather than a release commitment. Pushes, releases, deployments, and migration of the owner's production data require explicit authorization.

## 1. Stabilize and deliver the local persistence release

The local `main` now contains the operational SQLite store, non-destructive JSON migration, graceful shutdown, portable backup restore, custom Library images, and the first favorites slice. Before remote delivery:

- visually validate the current source build at desktop, mobile, and 200% zoom;
- rehearse SQLite schema upgrades through version 6 using synthetic data;
- verify a JSON backup before and after banner/profile-picture/favorites changes;
- review release and rollback notes as one coherent upgrade path;
- split or retain the local commits so migration, restore, customization, and documentation remain reviewable;
- only then push and prepare the next release after owner approval.

The running release installation and real owner data must remain unchanged during this validation.

## 2. Validate the Library Overview and independent 3×3

The local source implementation now supports:

- Overview as the initial Library page, with sibling tabs named Library and Monthly Log;
- an installation-wide start-page choice in Settings (Overview, Library, Monthly Log, or Activity), applied only when opening without an explicit route;
- schema-6/JSON-11 preference persistence, upgrade defaults, backup/restore, and failed-write rollback;
- collection metrics and the eight newest local Activity events, preserving independent successful loads;
- favorites in Overview's larger column, with separate genre and consumption cards in the smaller column;
- one shared All media/media-type filter for collection metrics, completed-only genres, and consumption from recorded progress in every status, without filtering favorites or activity;
- completed-only display fallback to known totals when progress is missing, with unchanged saved progress and explicit partial-data states rather than guessed durations;
- Library media-type artwork filters in compact vertical strips above status in the right sidebar;
- favorites without a nine-title product limit, using category tabs, a compact full-width responsive cover preview, and Show more/less;
- compact consumption rows with media names on the left, inline quantities/units and video time on the right, visible partial-data badges, and no Details section;
- visual selection and manual ordering from Overview, not Settings;
- a separately persisted 3×3 selection, chosen only from favorites, with up to nine per media type;
- local PNG export from the confirmed 3×3 order rather than the full favorites list;
- schema-5/JSON-10 migration preserving previous choices, portable backup/restore, deletion cleanup, and rollback.

Next refinements:

- visually validate Overview, category tabs, pickers, and mobile/200% zoom presentation with real artwork;
- evaluate the experimental vertical Library filters at desktop/mobile/200% zoom, including keyboard order, cover contrast, and combined filter/reset behavior;
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

Tracked in [#38](https://github.com/GMkonan/honne/issues/38). An optional hub for
independently managed public profiles is tracked separately in
[#46](https://github.com/GMkonan/honne/issues/46); its initial scope explicitly
excludes social feeds and follows.

A public projection must remain opt-in, expose only explicitly selected data, avoid publishing private management capabilities, and keep Honne private by default. Favorites may feed it later, but Library favorites and their PNG exports must not imply publication.

## 8. Internationalize with Weblate

Prepare first-party interface copy, accessibility labels, validation messages, and user-facing backend errors for translation. Define source language, fallback, catalog format, pluralization, date formatting, and the Weblate review workflow before implementation.

## 9. Documentation and repository cleanup

- Keep `README.md`, `DIAGRAMS.MD`, self-hosting, migration, and API documentation aligned with released behavior.
- Audit `AGENTS.md`, `docs/agents/`, module guidelines, and stale workflow notes without removing enduring engineering rules.
- Keep the repository understandable to its owner without adding process ceremony.

## Outside the current sequence

Ideas such as a separate Cartoon or Animation category (#67), broader personal metrics beyond the completed-only genre card (#34), upcoming releases (#33), offline support (#59), and public sharing remain valid but are not part of the current delivery sequence.

The following ideas were requested by the owner on 2026-11-03. They are recorded
for refinement, not implementation commitments or changes to the priorities above.

### Hosted interactive demo

Host a demo where prospective users can click through Honne, explore a populated
Library and Overview, and understand the product before installing it.

Guardrails and decisions to refine before exposing it:

- Use curated synthetic/demo data, isolated from every real installation. Never
  seed it from an owner's private backup or expose credentials, private notes,
  integration state, or real synchronization jobs.
- Decide between read-only browsing and isolated, temporary editing. Visitors
  must not be able to add arbitrary persistent content or damage the shared demo.
  Define session isolation, reset behavior, and cleanup if editing is offered.
- Enforce restrictions in the backend, not only by hiding interface controls.
  Review mutation endpoints, uploads, backup/restore, integration connections,
  and outbound provider operations for the chosen demo mode.
- Decide which discovery features use fixtures or cached data, and define bounded
  requests, storage, rate limits, and provider/hosting budgets. Public traffic
  must not turn into uncontrolled catalog API usage or remote writes.
- Choose hosting and maintenance ownership separately. Do not expose an existing
  private instance or introduce an obligatory hosted dependency for self-hosters.

The demo does not depend on public profiles or the hub. Its security model and
interactive capabilities remain open decisions; no hosted deployment is approved.

### Optional friends' activity in Overview

After the opt-in public profile in #38, explore an optional social area in
Overview showing activity from friends or followed profiles. The local personal
Overview must remain useful without enabling social features.

Scope and questions to refine:

- Read only activity explicitly published by participating profiles. Define
  friend/follow relationships, account identity, visibility, unfollowing,
  unpublishing, and cached-data retention before choosing an architecture.
- Investigate whether external services such as AniList can supply friends'
  public or properly authorized activity, including available API capabilities,
  consent, permissions, limits, attribution, and refresh behavior. This is an
  exploration, not a promise that existing Honne synchronization supports it.
- Distinguish read-only feed aggregation from bidirectional synchronization.
  Viewing a friend's activity must not modify the owner's Library, create local
  personal Activity events, or enqueue remote writes.
- If multiple installations need discovery or aggregation, evaluate the optional
  hub in #46 without adding social features to that issue's initial scope or
  requiring a centralized service for private Honne use.
- Keep sources identifiable, avoid duplicate events, and preserve local data and
  navigation when a remote source is unavailable. Choose the smallest useful
  slice before adding broader social behavior.

Demo exposure, public-profile publication, hub participation, and social/provider
integration are separate capabilities and require their own explicit design and
authorization before implementation or deployment.
