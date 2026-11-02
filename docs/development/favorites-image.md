# Overview favorites and independent 3×3 export

Library opens on Overview (`#library`, with `#overview` and legacy `#favorites`
links also supported). The sibling Library tab (`#library/list`) contains the
media lists; Monthly Log remains a separate chronological experience. Overview
shows collection metrics, the eight newest local Activity events, and a favorites
widget. Independent loading failures retain valid Library and favorites data.

The widget uses media-type tabs, four portrait-cover columns, eight covers at
first, and **Show more** / **Show less** for larger categories. Tabs support
Left/Right, Home/End, and keyboard focus. Missing covers retain title fallbacks.
Favorites are not edited from Settings.

## Favorites

**Choose favorites** / **Edit favorites** opens the visual Library picker. Search
local titles, switch types, and select as many unique Library titles as desired:
there is no nine-title product limit. A separate list exposes the selected titles
and order while searching. Search and category changes preserve the draft.

Nothing is persisted until **Save favorites** succeeds. Failed saves preserve the
draft and support retry; cancel discards edits. Removing a favorite also removes
it from the separate 3×3 selection in the same transaction, without filling the
vacant position with another title. Reordering favorites does not reorder 3×3.

## Independent 3×3

**Build 3×3** opens a second visual picker containing only saved favorites. Select
and order up to nine per media type independently of the favorites list. **Save
3×3** persists this selection; it never adds, removes, or reorders favorites.

Each nonempty saved 3×3 category offers **Download PNG**. Export is disabled while
there are unsaved changes or a save is pending. The browser creates
`honne-top-nine-<media-type>-3x3.png` at 1080 × 1200 px, with a category heading,
square 3×3 grid, centered cover crops, numbered positions, and titles in the
3×3's saved order. Empty slots remain empty. Missing covers use title placeholders
independently rather than failing the other tiles.

Both pickers focus search, contain Tab, support Escape/cancel, and restore focus
and scrolling. During a save controls and dismissal are blocked; navigation away
aborts obsolete work without claiming to roll back an already received write.

Only selected covers, titles, position labels, and Honne branding are rendered.
Notes, ratings, account details, and the profile name are excluded. Generating an
image does not publish a profile or upload the PNG. See
[the Overview persistence plan](overview-favorites.md) for schema-5/JSON-10
compatibility and rollback requirements.

## Cover requests and resource limits

Favorites and Monthly Log share the export cover loader. It first tries the
same-origin image proxy and then the original public cover URL with credentials
omitted and no referrer. Fetching cover assets can therefore contact their
public hosts; local image generation is not a promise of offline operation.

The loader rejects non-HTTP(S) URLs and URLs containing credentials, non-raster
response types, and responses exceeding 5 MiB, including streamed bodies without
a declared size. Attempts time out after ten seconds. Decoded images are limited
to 10,000 px per side and 16 million pixels. Each unavailable image falls back
independently, and temporary image/download object URLs are revoked.

The export button prevents overlapping work and announces generation, completion,
missing-cover fallbacks, or errors. Navigation away from the Library or a change to
favorite order/title/cover cancels obsolete work before it can download a stale
image. Errors leave the grid available and allow retry.

## Validation

Automated coverage includes favorites beyond nine in one category, independent
3×3 limits/order/membership, legacy selection migration, restart and backup/
restore, deletion and failed-write rollback, visual selection/search, category
preview/expansion, keyboard tabs and modal focus, save/cancel/retry, independent
loading failures, Overview routes/back navigation, and stale-work cancellation.
The renderer tests cover full/partial grids, crop positions, fallbacks, long
titles, encoding failure, and cleanup. Mocked canvas tests do not replace visual
inspection of a downloaded image.

With synthetic data, manually validate:

1. Add more than nine favorites in one type and favorites in several types.
   Check four-column layout, eight-cover preview, Show more/less, keyboard tabs,
   visual editing, and save/cancel/error states. Settings must not select favorites.
2. Build 1-, 5-, and 9-title 3×3 selections, with independent orders in two types.
   Check limits, saved-state export gating, filenames, dimensions, headings, and
   readable title clipping. Changing 3×3 must not alter favorites.
3. Remove a favorite used in 3×3 and delete a selected Library title. Confirm
   cleanup, persistence after reload, and portable backup/restore.
4. Include portrait/landscape artwork, long/non-Latin titles, missing or failed
   covers, and proxy-only covers. Verify fallbacks and generation feedback.
5. Check Overview, lists, and both pickers at 320 px, tablet, desktop, 200% zoom,
   and short viewports; inspect cropping, contrast, scrolling, focus containment,
   Escape/cancel, focus restoration, history navigation, and reduced motion.
6. Smoke-test Monthly Log and the existing Activity page after shared Activity
   formatting and image export changes.

Real-browser/image visual validation remains outstanding: the browser tool
reports that Chromium/Google Chrome is not installed. No browser or rendering
dependency was added.
