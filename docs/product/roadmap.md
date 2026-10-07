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

Refine issue #45 against the latest snapshot version and implement a safe migration after the initial 3×3 experience. Preserve logical JSON backup and restore, IDs, Activity, planned revisits, favorites, AniList outbox state, and rollback documentation.

## 9. Define an optional public profile

Refine issue #38 after the persistence migration. The public projection must remain opt-in, expose only explicitly selected data, avoid publishing private management capabilities, and keep Honne private by default.

## Outside the current sequence

Ideas such as a separate Cartoon or Animation category (#67), personal metrics (#34), upcoming releases (#33), and offline support (#59) remain valid but are not part of the current priority order.
