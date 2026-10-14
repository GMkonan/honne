# Product roadmap

This document records the owner's current priority order. It is a planning guide rather than a release commitment. Pushes, releases, deployments, and migration of the owner's production data require explicit authorization.

## 1. Stabilize and deliver the local persistence release

The local `main` now contains the operational SQLite store, non-destructive JSON migration, graceful shutdown, portable backup restore, custom Library banner, and the first favorites slice. Before remote delivery:

- visually validate the current source build at desktop, mobile, and 200% zoom;
- rehearse version-1-to-version-2 SQLite schema migration using synthetic data;
- verify a JSON backup before and after banner/favorites changes;
- review release and rollback notes as one coherent upgrade path;
- split or retain the local commits so migration, restore, customization, and documentation remain reviewable;
- only then push and prepare the next release after owner approval.

The running release installation and real owner data must remain unchanged during this validation.

## 2. Finish the 3×3 favorites experience

The initial local implementation supports:

- manual selection of up to nine Library titles;
- manual ordering across mixed media types;
- a private 3×3 composition in the Library;
- transactional persistence, JSON backup/restore, deletion cleanup, and rollback.

Next refinements:

- visually tune cover cropping, empty slots, spacing, and mobile presentation with real artwork;
- decide whether favorites should have a stable page/URL or remain a Library section;
- add an optional locally generated share image without requiring public publishing;
- keep favorites separate from Monthly Log history and any future public profile.

## 3. Validate Library personalization

The first local banner implementation accepts JPEG, PNG, WebP, or GIF files up to 8 MiB from Settings, stores the image in SQLite, includes it in JSON backups, and restores the bundled default on request.

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

A public projection must remain opt-in, expose only explicitly selected data, avoid publishing private management capabilities, and keep Honne private by default. Favorites may feed it later, but the private 3×3 must not imply publication.

## 8. Internationalize with Weblate

Prepare first-party interface copy, accessibility labels, validation messages, and user-facing backend errors for translation. Define source language, fallback, catalog format, pluralization, date formatting, and the Weblate review workflow before implementation.

## 9. Documentation and repository cleanup

- Keep `README.md`, `DIAGRAMS.MD`, self-hosting, migration, and API documentation aligned with released behavior.
- Audit `AGENTS.md`, `docs/agents/`, module guidelines, and stale workflow notes without removing enduring engineering rules.
- Keep the repository understandable to its owner without adding process ceremony.

## Outside the current sequence

Ideas such as a separate Cartoon or Animation category (#67), personal metrics (#34), upcoming releases (#33), offline support (#59), and public sharing remain valid but are not part of the current delivery sequence.
