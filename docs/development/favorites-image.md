# Library favorites and image export

Favorites live beside the collection in `#library`, with portrait covers grouped
by media type. On smaller screens, Status stays above the collection and favorites
stack below it. Existing `#favorites` links open the same integrated Library;
Favorites is no longer a separate navigation tab or a Settings card.

**Choose favorites** / **Edit favorites** opens an inline editor. Each category
accepts up to nine Library titles, independently of the others (63 total across
the seven supported types). Switching categories preserves the draft. Add,
remove, reorder, and cancel do not write until **Save favorites** succeeds. A
failed save preserves the draft and allows retry. The showcase and image exports
always use confirmed saved favorites, not the draft.

Each nonempty category offers **Download PNG**. The browser creates
`honne-favorites-<media-type>-3x3.png` at 1080 × 1200 px, with a category heading,
square 3×3 grid, centered cover crops, positions, and titles in that category's
saved order. Unfilled positions remain empty. A missing or unavailable cover
keeps its title placeholder instead of failing the other tiles.

Only favorite covers and titles are included, with Honne branding and position
labels. Personal notes, ratings, account information, and the Library profile
name are not rendered. Generating the image does not publish a profile, upload
the PNG, or change Library data, favorites, Activity, or synchronization jobs.

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

Automated coverage exercises per-type limits, cross-category draft preservation,
inline editing, save confirmation, cancel/focus restoration, loading failures
and retry independent of the Library/profile, legacy deep links, nine-position
layout and order, partial grids, fallbacks, long titles, PNG encoding failure,
unavailable canvas, keyboard
activation, retry, overlapping exports, cancellation, streamed size limits,
timeouts, URL validation, and cleanup. Canvas operations and encoding are mocked
in unit tests; they do not substitute for inspecting an actual downloaded PNG.

With synthetic data, manually validate:

1. Choose 1, 5, and 9 favorites per category, including more than nine across
   categories. Verify independent limits, ordering, save/cancel/error states,
   and the portrait cover groups beside the collection. Settings must not offer
   favorite selection. Export each category and verify unused positions,
   category heading, filename, dimensions, and readable title clipping.
2. Include portrait and landscape artwork, long/unbroken/non-Latin titles,
   absent covers, unavailable URLs, and covers requiring the proxy. Confirm that
   failed covers keep their titles and that the status explains the fallback.
3. Activate Download PNG by keyboard, confirm the busy state, exercise retry,
   and navigate away while covers load. No stale download should occur.
4. Check the page at 320 px, tablet, desktop, and 200% zoom without horizontal
   page overflow; inspect the PNG's actual crop, text, and contrast.
5. Smoke-test Monthly Log download after the shared-loader extraction.

Real-browser/image visual validation is still outstanding in this environment:
the browser tool reports that Chromium/Google Chrome is not installed. No new
browser or image-rendering dependency was added.
