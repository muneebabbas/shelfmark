Type: grilling
Status: claimed
Blocked by: 01, 02, 04
Claimed by: wayfinder session 2026-07-23

# Release-list "files already on disk" indicator + add-to-library button on work detail

## Question

This ticket owns **the integration point between search and the library**: the existing release-list UI gets a *dedup indicator* (a tick / "On disk" badge) per release, plus a "Use existing" affordance; and the work-detail modal gets an **Add to library** button.

The grilling session gave the rough shape:

- For releases that already have files on disk globally — show a tick / "On disk" badge. Don't auto-redirect, don't block re-download. The user can still pick another release.
- Books already in the user's library — when the user clicks "Add to library" on a search result, the routing branches per #02.

Open questions this ticket must resolve:

- **What does "this release is on disk" check against?** The grilling session's dedup resolution was "(source, task_id) pair" — a `download_history` row exists with `final_status = 'complete'` for `(source, task_id)` matching the displayed release. The architectural survey confirms `download_history` keys on `task_id` (the source's release ID, e.g. AA MD5) per `shelfmark/core/user_db.py:70-91`. Wire this check precisely.
- **Search endpoint extension.** The existing search-results endpoint returns releases. Does this ticket add an "already-on-disk" flag to each release's payload (join against `download_history` per release row), or does the frontend call a separate "is-on-disk" check per release (probably too chatty)? The former is the right answer via JOIN; decide where the JOIN lives (the search service vs the post-process layer).
- **Add-to-library button shape on the work detail modal** — placement, label, post-click behavior. Sits on the existing `DetailsModal`. Click triggers `POST /api/library/books` (#04); the response's `files_exist_globally` flag drives the route branch (#02). Settle the loading state UX (the click might trigger a metadata fetch).
- **"Use existing" affordance on the release row** — should it be there at all? The grilling session said tick+badge, no behaviour change; user can still pick another release. Does "Use existing" jump them to book detail (requires a book row to exist, which it might not — files-on-disk doesn't imply a `books` row). This is the crux of the question: a release being on disk doesn't mean a book entity has been created. Resolve the relationship; you can land at either "no Use Existing button — tick only" (simpler) or "Use Existing links to book detail when a books row exists for that release, otherwise disabled". Pick one and defend.

Output: written contract for the search results / release list / work-detail modal changes. Implementation lives in #12 (search integration).

## Outcome of this ticket

UX contract document. #12 implements against it.

## Grounded context (wayfinder session 2026-07-23)

Research on `main` @ `23bd49c`. #14's multi-file code lives on `feature/library-multi-file-release` (`5fcd684`), **unmerged to main** — flagged inline where it bites.

### The search pipeline (for Q1 + Q2)

- **Search route**: `GET /api/releases` at `shelfmark/main.py:2849-3106` (handler `api_releases`). Envelope at `main.py:3078-3084`: `{releases, book, sources_searched, column_config, search_info}`. There is no separate search *service* module — the search runs inline in the route via `_search_source_releases` (`main.py:2884-2934`), which calls each plugin's `source.search(search_book, plan, ...)` (`release_sources/__init__.py:326-334`).
- **Per-release serializer**: `_serialize_release` at `main.py:1065-1080` — a thin `asdict(release)` over the `Release` dataclass (`release_sources/__init__.py:59-77`). The fields a release row carries today: `source`, `source_id`, `title`, `format`, `language`, `size`, `size_bytes`, `download_url`, `info_url`, `protocol`, `indexer`, `seeders`, `peers`, `content_type`, `extra`. **There is no `task_id` on a search result** — `task_id` is minted at *queue* time (`DownloadTask.task_id` at `models.py:91`, "e.g. AA MD5 hash, Prowlarr GUID"), typically derived from `source_id`/`download_url`.
- **No dedup against `download_history` exists today** anywhere in the search or queue path. `_search_source_releases` does none; `api_download_release` (`main.py:1083-1150`) queues blindly; `record_download`'s `ON CONFLICT(task_id)` (`download_history_service.py:313`) is retry re-arming, not skip-because-on-disk.
- **The qbittorrent/usenet `find_existing` dedup** (`download/clients/__init__.py:340-357`; call site `base_handler.py:761`) is **client-side**, keyed on `Release.download_url` (resolved to info_hash for torrents). It checks the external download client, not `download_history` or disk. Not reusable for #09's "is_on_disk".

### The dedup key (for Q1) — the #14 sequencing snag

- **On `main`**: `download_history.task_id TEXT UNIQUE NOT NULL` (`user_db.py:76`). `task_id` alone is the de-facto dedup key. `record_download` upserts `ON CONFLICT(task_id)`; `get_by_task_id` (`download_history_service.py:393`) keys on it. `(source, task_id)` is **not** a constraint anywhere on main.
- **On `feature/library-multi-file-release` (#14, unmerged)**: `task_id` UNIQUE is dropped (`task_id TEXT NOT NULL`), non-unique `idx_download_history_task_id` added, "release" = derived `GROUP BY task_id` group of file rows (per #13 decision + `CONTEXT.md` File section). A given release now has 1..N `download_history` rows sharing `task_id`.
- **Implication**: the dedup predicate for "this search release is on disk" must check for ≥1 `download_history` row with `final_status='complete'` AND `download_path IS NOT NULL` where `task_id` matches the release. On main, that's `∃ row WHERE task_id = ?`; on #14, it's `∃ row IN (rows WHERE task_id = ?)` — same predicate shape, but #11's implementation must group. The predicate itself (question 1) is stable across both; the *quantity* of joined rows differs and the frontend groups in #08. #09 owns the predicate; the sequencing (merge #14 first, or land #09/#11 against main then rebase) is a #11 impl concern surfaced here.

### The `book_id` gap (forces Q4's answer)

- `download_history.book_id` (added by #03's migration, `user_db.py:321-340`) is **never populated by production code** on main — neither `record_download` nor `finalize_download_files` sets it (flagged on map at `map.md:50`). `library_service.files_exist_globally(book_id)` (`library_service.py:335-350`) filters `WHERE book_id = ?` and today finds nothing.
- **This is load-bearing for Q4.** "Use existing → jump to book detail" requires a `books.id` to navigate to. A release on disk (a `download_history` row with `complete` + `download_path`) does **not** imply a `books` row exists — the `book_id` column is NULL. The only code that creates a `books` row is the Add-to-library flow (`POST /api/library/books`, #04/#06). So a release can be on disk *without* a book entity, and the "Use existing" affordance cannot link to `/library/:bookId` when no `books.id` exists for that release.
- Wiring `book_id` into `record_download`/`finalize_download_files` is owned by #11 (per `map.md:50`). #09 sets the contract that #11 implements — so a clean answer is: **"Use existing" is tick-only (no link action) for the MVP**; the link-to-book-detail behaviour is gated on whether a `books` row exists for that `task_id`, which #11 can surface as a per-release `book_id: number | null` field. Q4 decides which.

### Release-list frontend (for Q3 + Q4)

- **`ResultsSection.tsx:40-303`** orchestrates three views (`resultsViews/ListView.tsx`, `CompactView.tsx`, `CardView.tsx`). Each row gets a `Book` + a `ButtonStateInfo` (`types/index.ts:83-87`: `{text, state: ButtonState, progress?}`). `ButtonState` union (`index.ts:73-81`): `'download' | 'queued' | 'resolving' | 'locating' | 'downloading' | 'complete' | 'error' | 'blocked'`.
- **The Get/+ button dispatcher**: `BookActionButton.tsx:24-66` — branches on `searchMode === 'universal'` (from `useSearchMode()` / `SearchModeContext.tsx`), routing to `BookGetButton` (green `bg-emerald-600`, `BookGetButton.tsx:93-94`) in Universal mode or `BookDownloadButton` in direct mode. Click → `onGetReleases(book)` → opens ReleaseModal. **This is the existing seam** the Add-repurposes-Get decision (#02) plugs into.
- **Plausible insertion points for an "On disk" badge**: card footer at `CardView.tsx:246-260` / mobile row `CardView.tsx:232-243`; list action cell `ListView.tsx:290-339` (before the Details button at `:301`).
- **Plausible seam for "In Library" state** (per #02's Sonarr/Radarr-style disabled-button-navigates-to-`:bookId`): a new `ButtonState` value, or pre-check inside `getUniversalActionButtonState` (`App.tsx:1893-1919`) which already post-processes universal-mode button state for dismissed-task re-arming.

### DetailsModal (for Q3)

- `src/frontend/src/components/DetailsModal.tsx`, opened via `handleShowDetails` at `App.tsx:943-978` (fetches metadata for `isMetadataBook(book)` rows, else source record, then `setSelectedBook`).
- Footer at `DetailsModal.tsx:374-425`: source link (left), optional `BookTargetDropdown` (`:396-403`), and the action button (`:405-422`) which **already branches** on `isMetadata` — Universal mode calls `onFindDownloads?.(book)` (opens ReleaseModal); direct mode calls `handleDownload()` (queues). The button label in Universal mode is `'Find Downloads'` when state is `download`+text `'Get'`, else `buttonState.text` (`DetailsModal.tsx:88-91`).
- **Add-to-Library button insertion point**: the right-side flex container at `DetailsModal.tsx:395` — alongside the existing action button. Per #02, Add *repurposes* the existing green Get/+ button (Universal mode only) — so the modal footer's `isMetadata` branch (`:408-413`) is the existing seam. The question is whether Add-in-library state ("In Library", navigates to `/library/:bookId`) is a new `ButtonState` driving the same button, or a separate sibling button. Q3 decides.
- **Loading state**: the Add click triggers `POST /api/library/books` (#04), which does a synchronous metadata fetch (`_resolve_metadata_book_for_library`, #06) — can take noticeable time. The footer's button already has `disabled`+label-swapping infrastructure; the prototype's "loading" state (`BookDetailPage` first-pass) reused this pattern. Q3 settles the exact UX (spinner vs label-swap vs both).
