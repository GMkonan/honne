# Product roadmap

This document records the owner's current priority order. It is a planning guide rather than a release commitment; the linked GitHub issues remain the durable source for detailed product decisions.

## 1. Stabilize and deliver Monthly Log

- Replace the current prominent Library entry point with a compact, better-positioned action.
- Remove the oversized decorative mark from the Monthly Log heading.
- Align and refine the media-type selector.
- Visually validate exports with up to 15 titles, 16–30 titles, and more than 30 titles.
- Keep detailed cards for up to 15 titles, switch denser logs to cover-only artwork, and identify titles omitted beyond the image limit.
- Split the local work into reviewable pull requests, merge it into `main`, and include it in the next release.

Monthly Log is a chronological record. It remains separate from manually curated favorites.

## 2. Refine planned revisits

- Replace the current prominent edit control with a simpler option.
- Preserve type-aware language for rewatching, rereading, replaying, or revisiting.
- Replace the full Library-card label with a compact cover icon that remains visually secondary to the primary status.

This refines the behavior delivered by issue #69 without changing the meaning of `Completed` or repeat counts.

## 3. Refine Edit Library actions

- Establish clear primary, secondary, tertiary, and destructive action hierarchy.
- Keep `Save changes` primary and make `Cancel`, title editing, and removal compact and intentional.
- Avoid oversized text actions and excessive spacing.

## 4. Remove the application footer

Keep the application chrome focused on the primary header and page content. Required provider attribution remains contextual and appears only when the current page uses that provider's data.

## 5. Allow a custom Library banner

Let the owner replace the built-in Library hero artwork with an image of their choice.

- Keep the current artwork as the default and provide a clear reset action.
- Preserve profile readability, contrast, and responsive cropping across custom images.
- Decide whether the first implementation accepts an uploaded local asset, an image URL, or both after reviewing persistence and backup implications.
- Keep private installation details and remote credentials out of image requests.

## 6. Reassess the deferred frontend refactor

Review issue #9 and the unintegrated `issue-10` work before resuming it. Clarify which parts are still valuable, especially:

- extracting responsibilities from `App.tsx` and the global stylesheet;
- typed services and contracts;
- page and state boundaries;
- stable non-hash routes;
- accessible shared primitives;
- the proposed Zustand, React Router, and Tailwind migrations.

Do not resume the broad migration until its current value, sequence, and reuse of prior work are understood.

## 7. Build the initial 3×3 favorites experience

Refine issue #5 around the current product direction:

- manually select up to nine favorite media;
- manually order the selection;
- allow mixed media types;
- present the result as a 3×3 composition;
- keep favorites separate from Monthly Log history;
- consider a shareable image without making public publishing a requirement.

The first version may use the current versioned snapshot, with its data model designed for later SQLite import.

## 8. Migrate persistence to SQLite

Owner priority update (2026-10-11): prepare SQLite now, without waiting for the initial 3×3 experience. The pure-Go driver and transactional synthetic importer are now implemented locally; the runtime still uses JSON. Preserve logical JSON backup and restore, IDs, Activity, planned revisits, any favorites supported at activation time, AniList outbox state, and rollback documentation. See [the implementation and activation plan](../development/sqlite-migration.md). Runtime activation, deployment changes and real owner-data migration remain unauthorized.

## 9. Define an optional public profile

Refine issue #38 after the persistence migration. The public projection must remain opt-in, expose only explicitly selected data, avoid publishing private management capabilities, and keep Honne private by default.

## 10. Internationalize the full application with Weblate

Prepare all first-party user-facing text for translation and use Weblate so community contributors can maintain additional languages.

- Keep stable, language-independent identifiers for routes, statuses, media types, and persisted values.
- Extract interface copy, accessibility labels, validation messages, and user-facing backend errors into translation catalogs.
- Support pluralization, interpolation, dates, and locale-aware formatting without assembling translated sentences from fragments.
- Define the source-language and fallback behavior, catalog format, review workflow, and whether Weblate is hosted or self-hosted before implementation.
- Document how contributors add and review translations without requiring changes to application code.

## 11. Rewrite the README

Replace the incremental README with a concise entry point for users and contributors.

- Explain what Honne is, who it is for, and its private, self-hosted, local-first model.
- Present the current feature set with up-to-date screenshots or artwork.
- Keep installation, update, backup, recovery, and security guidance easy to find without duplicating detailed operational documentation.
- Link clearly to releases, contribution guidance, translation participation, funding, and the product roadmap.
- Remove stale names, screenshots, claims, and setup instructions during the rewrite.

## 12. Audit AI-agent documentation

Remove or update stale Markdown and guidance created specifically for AI-agent workflows while preserving the project rules that remain useful to human contributors and automation.

- Inventory `AGENTS.md`, `docs/agents/`, module guidelines, and cross-references before deleting files.
- Consolidate duplicated rules and move enduring engineering, validation, language, and delivery guidance to the most appropriate project documentation.
- Remove obsolete workflow notes, abandoned process experiments, and AI-specific wording that no longer reflects how the project is maintained.
- Keep repository instructions discoverable and ensure remaining links and references are valid after the cleanup.

## Outside the current sequence

Ideas such as a separate Cartoon or Animation category (#67), personal metrics (#34), upcoming releases (#33), and offline support (#59) remain valid but are not part of the current priority order.
