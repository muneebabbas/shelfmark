# Ebook Reader Stack Research

Research date: 2026-08-09. Resolves [issue #100](https://github.com/muneebabbas/shelfmark/issues/100), child of [map #93](https://github.com/muneebabbas/shelfmark/issues/93). Sources are first-party documentation, specifications, or source repositories.

## Decision

Recommend an **EPUB-only browser reader based on epub.js**, with a normalized EPUB representation selected per original File:

1. EPUB Files are rendered directly.
2. AZW3 Files use the upstream ingest-created companion EPUB at its known path.
3. MOBI Files receive one ingest-time Calibre `ebook-convert input.mobi output.epub` companion EPUB, retained beside the original File and referenced by a server-side representation record.

The reader API should expose only an authorized publication/manifest resource route, never a filesystem path. The frontend should serve the EPUB through that route and save a portable locator consisting of `representation_id`, spine/content `href`, EPUB CFI where available, text quote, and normalized `progression`; the File remains the progress ownership key. A fallback to download must remain available when conversion or rendering fails.

Do not make Calibre or Readium a request-time browser dependency. Keep the original AZW3/MOBI artifacts unchanged for download and fidelity, and treat companion EPUBs as reader projections rather than replacements.

## Why EPUB is the common representation

The W3C EPUB 3.3 Recommendation defines EPUB as a ZIP container of HTML/XHTML, CSS, SVG, images, and other resources. Its package document supplies the manifest and ordered spine; its navigation document supplies machine- and human-readable navigation including a table of contents. EPUB is reflowable by default, with a separate fixed-layout mode. [W3C EPUB 3.3, overview and package/navigation/layout sections](https://www.w3.org/TR/epub-33/#sec-intro-overview)

That model maps directly to mobile web rendering and the agreed V1 features. Formatting, images, tables, and ordinary footnotes represented as HTML links/targets are browser content, but exact presentation depends on the publication CSS and renderer. EPUB does not guarantee that every reading system implements every HTML/CSS feature. [W3C EPUB 3.3, content documents and security](https://www.w3.org/TR/epub-33/#sec-contentdocs)

## Candidate comparison

| Option | Mobile, content, navigation, pagination | Fidelity and progress location | Security | License, maintenance, footprint |
| --- | --- | --- | --- | --- |
| **epub.js** | Explicitly renders EPUB in browsers across devices. Its default manager is section-at-a-time; its continuous manager preloads sections and is documented for mobile/desktop. It supports paginated and scrolled flows. HTML/CSS handles basic formatting, images, tables, and linked footnotes; specialized EPUB behavior still needs compatibility tests. [epub.js README](https://github.com/futurepress/epub.js) | Designed for rendering, persistence, and pagination. Its public API/source includes locations/CFI concepts, so `href + CFI/quote + progression` is a practical portable bookmark. Pagination is viewport-dependent, not a stable printed page number. [epub.js API source](https://github.com/futurepress/epub.js/tree/master/src) | Scripted content is disabled by default in a sandboxed iframe; epub.js recommends server-side sanitization. Enabling scripted content is explicitly called insecure. The server must also constrain archive paths, external resources, MIME types, and response headers. [epub.js README security section](https://github.com/futurepress/epub.js#scripted-content); [W3C EPUB security](https://www.w3.org/TR/epub-33/#sec-security-privacy) | BSD-2-Clause, permissive. The repository is established and has a published `0.3.93`, but its API/docs are old enough that browser compatibility and dependency updates must be pinned and tested. The client bundle includes JSZip and related runtime dependencies; no Calibre process or server-side EPUB parse is required for direct EPUB. [package.json](https://raw.githubusercontent.com/futurepress/epub.js/master/package.json); [license](https://raw.githubusercontent.com/futurepress/epub.js/master/license) |
| **Calibre CLI** | Not a web renderer. `ebook-convert` converts input/output formats and exposes many formatting, TOC, image, table, and page-break controls. This is useful before reading, not as a mobile UI. Calibre’s own docs recommend converting to EPUB for browser/mobile use. [ebook-convert CLI](https://manual.calibre-ebook.com/generated/en/ebook-convert.html); [Calibre FAQ device/browser guidance](https://manual.calibre-ebook.com/faq.html#how-do-i-use-my-calibre-books-with-my-ipad-iphone-ipod-touch) | Strong format coverage: official docs list EPUB, AZW3, MOBI as input/output and state that MOBI Mobi6 and KF8 are supported. Conversion is lossy by nature and Calibre explicitly does not guarantee every produced EPUB is valid; validate and fixture-test companions. Metadata TOC handling is notably format-specific: MOBI lacks proper metadata TOC support, while AZW3 has it. [Calibre format FAQ](https://manual.calibre-ebook.com/faq.html#what-formats-does-calibre-support-conversion-to-from); [MOBI TOC FAQ](https://manual.calibre-ebook.com/faq.html#what-s-the-deal-with-table-of-contents-in-mobi-files) | The converter processes untrusted book content, so run it as a low-privilege, resource-limited worker with isolated input/output directories, no network, timeouts, and archive/path validation. Calibre’s CLI documents an explicit local-file escape that “can be a security risk” for untrusted input, reinforcing that conversion is a trust boundary. [HTML input option](https://manual.calibre-ebook.com/generated/en/ebook-convert.html#cmdoption-ebook-convert-html-input-allow-local-files-outside-root) | GPLv3. This is acceptable as an isolated server executable, but it creates source-distribution and operational obligations that a BSD frontend library does not. It is a substantial server/package footprint and process dependency, so invoke it at ingest, cache the result, and do not ship it in the frontend. [Calibre license](https://github.com/kovidgoyal/calibre/blob/master/LICENSE); [CLI overview](https://manual.calibre-ebook.com/cli-index.html) |
| **Readium r2-navigator-js + r2-streamer-js** | A credible standards-oriented alternative with navigator, streamer, Readium CSS, pagination, TOC/link handling, and security-oriented publication origins. However, the official navigator README says browser JavaScript is not supported and describes Electron main/renderer processes; it is not a drop-in React/mobile-web package. [r2-navigator-js README](https://github.com/edrlab/r2-navigator-js); [r2-streamer-js README](https://github.com/edrlab/r2-streamer-js) | Its `LocatorExtended` is the strongest documented progress model considered: publication `href`, CFI, CSS selector, text context, progression, and pagination columns. That is valuable future vocabulary, but the implementation’s documented target is desktop/Electron and it adds integration complexity. [navigator reading-location API](https://github.com/edrlab/r2-navigator-js#reading-location-linking-with-locators) | Readium streamer offers publication isolation/origin mechanisms and optional encrypted headers, but its security model is designed around its own server/Electron integration. Adopting it would require validating browser authorization and cross-origin behavior rather than assuming the examples are safe for Shelfmark. [streamer server security example](https://github.com/edrlab/r2-streamer-js#basic-usage) | BSD-3-Clause for navigator/streamer. Maintenance is active enough to have large source trees and changelogs, but the package graph is broad and the README documents old Node/Electron assumptions. It materially increases server and frontend integration footprint compared with epub.js. [navigator license](https://raw.githubusercontent.com/edrlab/r2-navigator-js/develop/LICENSE); [streamer license](https://raw.githubusercontent.com/edrlab/r2-streamer-js/develop/LICENSE) |

## Format-specific findings

### EPUB

Direct EPUB preserves the publisher’s HTML/CSS/images and navigation without a conversion round trip. It is the best fidelity option available to a browser reader, but “format fidelity” still means supported EPUB/HTML/CSS behavior, not pixel identity. Reflow changes page counts when viewport, font size, or settings change. Store a semantic locator and use progression/page-column data only as a derived UI value.

### Companion EPUB for AZW3

Use the map’s settled upstream companion-EPUB rule. Preserve the AZW3 File and its independent File-specific progress. The companion should carry a conversion/provenance record, source File identifier, converter version/options, checksum, and failure state. Never silently substitute the companion for download or claim that its pagination equals AZW3 device pagination. Calibre documents AZW3 as a distinct format with proper metadata TOC support, so retaining the original matters for fidelity and advanced Kindle behavior. [Calibre format FAQ](https://manual.calibre-ebook.com/faq.html#what-s-the-deal-with-table-of-contents-in-mobi-files)

### MOBI

Do not attempt to render MOBI directly in the browser. Calibre explicitly supports MOBI input, including Mobi6 and KF8, and EPUB output. Convert once at ingest to EPUB, retain the MOBI original, and show a clear “reader representation” failure if conversion is unavailable. Expect variation in tables, CSS, footnote links, images, and TOC because conversion reconstructs a modern EPUB from a legacy/container-specific format. Keep the converted EPUB’s navigation and generated metadata stable by pinning Calibre version and options.

## Acceptance matrix

| Criterion | Recommendation / acceptance bar |
| --- | --- |
| Mobile behavior | epub.js paginated mode must support narrow viewport, rotation, touch page turns, dynamic font size, and long chapters; continuous mode is an optional fallback for books that do not paginate cleanly. Test iOS Safari and Android Chrome. |
| Basic formatting/images | Render headings, paragraphs, emphasis, lists, links, images, SVG where supported, CSS tables, and common footnote link/target patterns. Unsupported media/script must fail closed or degrade without breaking download. |
| Navigation | Use EPUB navigation document/TOC, spine order, internal fragment links, back-to-reading-position, and external-link policy. Test missing/legacy navigation and malformed links. |
| Format fidelity | Direct EPUB is baseline. AZW3/MOBI companions are explicitly projections; test representative fixtures and preserve originals. Do not promise Kindle pagination or identical CSS. |
| Pagination | Persist semantic location; derive visible page/percentage from the current viewport. Recalculate after settings/viewport changes. Never use a bare page number as the durable key. |
| Security | Serve only authorized File representations through opaque routes. Sanitize or reject scripts, block filesystem escape and unauthorized remote fetches, isolate conversion workers, enforce size/time limits, and retain CSP/sandbox controls. Follow EPUB’s threat model rather than trusting an archive. [W3C security and privacy](https://www.w3.org/TR/epub-33/#sec-security-privacy) |
| Licensing | Prefer epub.js BSD-2-Clause in the frontend. Isolate Calibre GPLv3 as an executable dependency and document its license/source obligations. Readium is permissive but not selected because its browser target is unsupported. |
| Maintenance | Pin epub.js and Calibre versions, record versions in representation metadata, run fixture tests on upgrade, and keep a graceful-download path. Reassess epub.js if browser support or release activity stops. |
| Bundle/server footprint | Frontend ships epub.js and its required archive/runtime dependencies only. Server stores companions and runs Calibre at ingest, not per page/request. A future Readium experiment must be a separate spike, not a hidden dependency. |
| Progress quality | Persist File-specific progress plus `representation_id`, spine/content `href`, CFI if available, text before/highlight/after, progression, and optional pagination snapshot. Treat quote/href as recovery data when layout changes. |

## Tradeoffs and follow-up decisions

- epub.js minimizes implementation and deployment risk, but its locator and standards coverage must be verified against real fixtures; the package does not provide Calibre-level format conversion.
- Calibre improves MOBI/AZW3 coverage at the cost of GPLv3 compliance, worker isolation, CPU/storage use, and lossy conversion. It must remain ingest-only and observable.
- Readium offers the best documented locator vocabulary and a standards-oriented architecture, but its official JS components are not browser-web components. Selecting it would require a separate prototype and likely a broader server/Electron architecture change.
- This research does not select a KOReader transport. The recommended locator fields are intentionally portable enough to map later, while current progress remains one state per user and original File as required by map #93.

## Sources

- [W3C EPUB 3.3 Recommendation](https://www.w3.org/TR/epub-33/)
- [epub.js official repository and README](https://github.com/futurepress/epub.js)
- [epub.js package metadata](https://raw.githubusercontent.com/futurepress/epub.js/master/package.json)
- [Calibre official user manual and CLI](https://manual.calibre-ebook.com/)
- [Calibre `ebook-convert` reference](https://manual.calibre-ebook.com/generated/en/ebook-convert.html)
- [Calibre format and MOBI TOC FAQ](https://manual.calibre-ebook.com/faq.html#what-formats-does-calibre-support-conversion-to-from)
- [Calibre official source/license](https://github.com/kovidgoyal/calibre)
- [Readium r2-navigator-js official source](https://github.com/edrlab/r2-navigator-js)
- [Readium r2-streamer-js official source](https://github.com/edrlab/r2-streamer-js)
