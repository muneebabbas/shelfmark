# Portable Reading Locations and KOReader Interoperability

Research date: 2026-08-09. This is a research resolution for [issue #95](https://github.com/muneebabbas/shelfmark/issues/95), child of [map #93](https://github.com/muneebabbas/shelfmark/issues/93). No application code or map content is changed by this note.

## Recommendation

Store one current progress record per `(user, original_file)` and treat the record as a **format-neutral locator envelope with optional renderer-specific evidence**, not as a page number.

Recommended normalized fields:

| Field | Meaning | Constraint |
| --- | --- | --- |
| `user_id` | Reader owner | Foreign key to the user |
| `file_id` | Original Shelfmark File, not a Book or format family | Foreign key; unique with `user_id` |
| `progression` | Current position through the publication | Nullable float in `[0, 1]` |
| `position` | One-based reading-order resource index | Nullable positive integer; useful when the renderer exposes it |
| `location` | Portable locator envelope | JSON object, nullable until a renderer reports one |
| `renderer` | Renderer/provider that produced the fallback | Short stable identifier, nullable |
| `updated_at` | Last accepted progress timestamp | UTC timestamp |

The `location` envelope should follow the Readium Locator shape: `href`, `type`, `locations`, and optional `text`. Inside `locations`, use `fragments`, `progression`, `position`, and `totalProgression` where available. `href` identifies the resource and must not contain the fragment; the fragment remains in `locations.fragments`. [Readium Locator model](https://readium.org/architecture/models/locators/)

For resume, the normalized source of truth is `progression` plus the best available location. `totalProgression` is useful denormalized context, but should not be treated as an invariant: pagination and layout can change. `text.before`, `text.highlight`, and `text.after` are recovery evidence, not a replacement for a structural location. Readium defines these fields and specifically recommends progression, total progression, position, and a format-specific locator for EPUB progress. [Readium Locator model](https://readium.org/architecture/models/locators/); [Readium format best practices](https://readium.org/architecture/models/locators/best-practices/format.html)

## Portable Primitives

### EPUB

EPUB CFI is the strongest portable primitive for a reflowable EPUB. The specification defines a publication-level fragment identifier, structural steps through the package/spine and content document, UTF-16 character offsets, ranges, text assertions, and side bias. IDs and text assertions are explicitly intended to detect and correct references after document revisions. [EPUB CFI 1.1, overview and processing](https://idpf.org/epub/linking/cfi/epub-cfi.html#sec-overview-purpose-and-scope); [CFI path resolution](https://idpf.org/epub/linking/cfi/epub-cfi.html#sec-path-res); [target correction](https://idpf.org/epub/linking/cfi/epub-cfi.html#sec-target-correction)

Store an EPUB locator with:

```json
{
  "href": "OPS/chapter.xhtml",
  "type": "application/xhtml+xml",
  "locations": {
    "fragments": ["epubcfi(/6/4[chap]!/4/10/2/1:37[preceding,following])"],
    "progression": 0.42,
    "position": 5
  },
  "text": {
    "before": "preceding",
    "highlight": "current text",
    "after": "following"
  }
}
```

The example is illustrative; production must use the renderer’s correctly escaped CFI. Keep a resource `href` separate from the fragment even though a standard CFI URI can be expressed against the publication. CFI assertions improve recovery, but a changed or malformed book can still make a CFI invalid, so preserve progression and text context as fallbacks.

### Companion EPUB

A companion EPUB is still an EPUB location problem, not a new normalized progress type. Use the same envelope and prefer CFI plus text context when the companion’s resource structure is stable. Keep the renderer-specific fallback in a separate field keyed by the actual companion file and renderer. Do not assume the companion’s CFI, spine positions, or chapter `href`s correspond to another original File; this ticket does not define cross-format or cross-file synchronization.

### MOBI

There is no equivalent open, general-purpose portable location standard established by the sources reviewed here for MOBI. Do not manufacture an EPUB CFI for MOBI. Store normalized `progression` and, when exposed, `position`; preserve a renderer fallback such as page/index and text context under a renderer-specific key. A page number is only meaningful with the renderer/layout that produced it.

This is consistent with the portable locator model: fragments are media-specific and must be interpreted in the context of the resource type, while progression and position remain generic. [Readium fragments and location model](https://readium.org/architecture/models/locators/#fragments)

## Renderer and KOReader Findings

KOReader’s reader code distinguishes page-oriented and rolling/reflow positions. Its bookmark module stores either a page number or a document XPointer, choosing the latter outside paging mode; it can convert an XPointer to a page and navigate back to it. [KOReader `readerbookmark.lua`](https://github.com/koreader/koreader/blob/master/frontend/apps/reader/modules/readerbookmark.lua)

KOReader’s paging module persists `last_page`, `page_positions`, and `percent_finished`. It documents page position as a fraction within a page so a location can be approximately restored after font, margin, or line-spacing changes. This is valuable renderer fallback data, but it is not a portable EPUB location primitive. [KOReader `readerpaging.lua`](https://github.com/koreader/koreader/blob/master/frontend/apps/reader/modules/readerpaging.lua#L130-L180)

KOReader’s reflow renderer is Cool Reader Engine (`crengine`). The source exposes document XPointer operations, including `getXPointer`, `gotoXPointer`, page conversion, comparison, and normalized XPointer/DOM-version APIs. These are renderer/document-engine contracts, not an interchange standard. [KOReader `credocument.lua`](https://github.com/koreader/koreader/blob/master/frontend/document/credocument.lua#L125-L160); [XPointer operations](https://github.com/koreader/koreader/blob/master/frontend/document/credocument.lua#L420-L490)

KOReader’s official Progress Sync documentation says the default document matching method hashes the binary so only the exact same file synchronizes; filename matching is an explicit alternative. It also says the service does not receive the filename or content and requires copies on both devices. Therefore a future KOReader integration should preserve exact original-file identity and should not equate title/author metadata with document identity. This ticket does not specify the sync protocol or implement it. [KOReader Progress sync documentation](https://github.com/koreader/koreader/wiki/Progress-sync)

## Field and Fallback Matrix

| Original File format | Portable location to prefer | Normalized fields | Renderer fallback |
| --- | --- | --- | --- |
| EPUB | Resource `href` plus EPUB CFI fragment | `progression`, optional `position`, optional `totalProgression`, text context | CSS/DOM locator or renderer page/offset if CFI cannot be produced |
| Companion EPUB | Same EPUB Locator shape for that actual file | Same fields, scoped to the companion `file_id` | Companion renderer page/offset and text context |
| MOBI | No format-standard fragment assumed | `progression`, optional `position`, optional `totalProgression` | Renderer page/index, engine pointer if available, and text context |

All renderer fallbacks must be opaque to the normalized layer, versioned by renderer identifier, and scoped to the original `file_id`. On restore, try the strongest location first, then text/context or renderer fallback, then normalized progression. A failed exact location must not overwrite a usable normalized progression with zero.

## Boundaries

This research does not define how progress should move between an EPUB and its companion EPUB, between EPUB and MOBI, or between different source files. It does not select a KOReader server API, matching hash algorithm, authentication method, or conflict policy. Those would be separate design and implementation work.

## Resolution

Adopt a Readium-shaped locator envelope and normalized progression/position fields per user and original File. Prefer EPUB CFI for EPUB-family renderers, preserve text context for recovery, and use opaque renderer-specific page/index/XPointer fallbacks for MOBI and any renderer that cannot emit a portable CFI. Preserve exact File identity so a later KOReader integration can reason about the same binary without requiring this ticket to design synchronization.
