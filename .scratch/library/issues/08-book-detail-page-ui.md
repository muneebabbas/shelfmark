Type: prototype
Status: claimed
Blocked by: 04, 05, 07, 13

# Book detail page UI (with per-format downloads and Send-to-Kindle)

## Question

Build the new book detail page — the destination of Add-to-library per #02 (both files-exist and no-files branches land here). The central UI surface where downloads and Send-to-Kindle live.

This is a **prototype ticket** (per the wayfinder taxonomy): raise the fidelity of the discussion by making a concrete artifact to react to. The prototype can be:
- A. A static React stub that fetches mock data (or hits the live API from #06 if it's landed) and renders the layout. React-with-mock-data is fine.
- B. The full working component — only if #06 has shipped first.

Pick A if the API isn't ready, otherwise B.

**Scope per #02's resolution** — book detail is an "expanded `ReleaseModal`-style shell" that hosts the Find Releases modal. The page must host:

- **Cover image** — from metadata provider (`books.cover_url`). The grilling session settled on metadata-provider covers only — no file-extracted covers as fallback.
- **Title, author, subtitle, year, series** — denormalized from the `books` row.
- **Formats on disk section** — one row per available format (e.g. EPUB, MOBI, AZW3), shown when `files_exist_globally == true`. Each row shows the format name and a **Download** button for that format.
- **Empty state when `files_exist_globally == false`** — "no formats on disk yet" state with a persistent **Find Releases** button (graduated from #02 sub-decision 7). This is the state the user sees if they close the auto-opened Find Releases modal without picking.
- **Find Releases button** (always present) — opens the existing `ReleaseModal` (via the `setReleaseBook` pattern at `App.tsx:1608-1631`). When `files_exist_globally == false` and `LIBRARY_AUTO_FIND_RELEASES=true` (#02 sub-decision 5), the modal auto-opens on page load. Behavior of re-picking a release when files already exist is fog (parked on map); #08 does not need to resolve it.
- **In-flight downloads indicator** — if any downloads are currently active for this book across users (`final_status = 'active'` per #02's predicate), show an indicator (not the user — just "a download is in progress").
- **Send to Kindle** — one button, label shows the resolved format ("Send EPUB to Kindle"), with an adjacent override picker per #05. Greyed-out with tooltip when no Kindle-compatible format is on disk. Configured Kindle address is surfaced somewhere visible (settings link).

The architectural survey surfaces primitives worth reusing:
- Existing `DetailsModal` (`src/frontend/src/components/DetailsModal.tsx`) for the metadata-fetch shape. Decide whether to extend it into a routed page or build fresh.
- `Tailwind CSS 4` styling, **no component library** — match the hand-rolled primitives in `src/frontend/src/components/shared/`.

Foundational work this ticket drives: the actual `react-router-dom` route addition, the shared layout (header visible on library routes?), the activity-sidebar-stays-accessible rule from #07. The prototype IS where those decisions get tested.

Verification: `make frontend-typecheck` passes; the book-detail page renders against mock data without crashing; the activity sidebar still renders when navigated there.

## Outcome of this ticket

Prototype React code on the feature branch, plus a written note in the resolution about what worked and what didn't — particularly anything that challenges the assumptions in #02 or #07.

## Update from #04 (applied when #04 was resolved 2026-07-20)

#04 reshaped book-detail's scope. The page now hosts:

- **Cover/title/author/subtitle/year/series** — unchanged from above, denormalized from the `books` row.
- **Formats-on-disk as a UNION across all `download_history` rows for the Book** (high-level view): one row per unique format (epub, mobi, azw3, pdf, ...), deduped across releases. Each row has a Download button.
- **Per-file list (release-level detail)** — underneath the union view, the page shows one row per `download_history` row linked to the Book (and visible to this user via `user_downloads`), with: `{format, size, indexer_display_name, protocol, downloaded_at, downloadable_by_me}`. This is where release-level metadata surfaces.
- **Unlink affordance per file row** — `DELETE /api/library/books/:book_id/downloads/:history_id`; hard-deletes the `user_downloads` link; file/`download_history` row untouched. Available to the user on files they've linked via their own `user_downloads`.
- **Empty state when no files exist** — unchanged from above. Persistent Find Releases button.
- **Find Releases button** — always present, ungated for all users. (Q3 grab gate from earlier #04 grilling is **repealed** — users can grab another release anytime.) When `files_exist_globally == false` and `LIBRARY_AUTO_FIND_RELEASES=true`, still auto-opens on page load (#02 sub-decision 5).
- **In-flight indicator** — unchanged from above. Shows "a download is in progress" when `in_flight_globally == true` (no user attribution).
- **Send to Kindle** — one button, label "Send <FORMAT> to Kindle" (the format per #05's algorithm), with an adjacent inline override picker (per #05's narrowed scope — #05 decides priority; #08 implements the UI for the picker). Greyed-out with tooltip when no Kindle-compatible format is on disk (per #05 sub-decision 2).
- **No manual refresh button**, no refresh-metadata affordance. Out of scope for this effort per #04 sub-decision 18 — the `books` row at Add time is final for this MVP.

**Unlink mid-flight** (a user unlinks an active `final_status='active'` `download_history` row from their `user_downloads`) — UX decision: disallow with error, or allow with warning that "the file will still complete but you won't see it until you re-add." Parked as the one open UX sub-decision for #08 itself.

#08's open questions (still owned by #08, not #04):

- `bookId` shape for the URL (numeric DB id vs slug) — actually #07's call, but #08 consumes it.
- Whether to extend `DetailsModal` into a routed page or build fresh — prototype-time decision.
- Loading & error states — referenced from #07's contract.
- Activity sidebar accessibility on library routes — referenced from #07's contract.
- Unlink mid-flight UX (above).

## Answer

> **Superseded 2026-07-20** — reopened; resolution withdrawn.
>
> Reviewer feedback after the prototype shipped surfaced a real data-model gap: **a single torrent download produces multiple files on disk** (`shelfmark/download/postprocess/transfer.py:416-451` transfers N files into the library), but `transfer.py:478` returns only `transferred_paths[0]`, so `finalize_download` writes one path + one `format` to `download_history`. The other N-1 files exist on disk but are invisible to `download_history` and therefore to the #04/#06 library API. My #08 resolution modelled the #04 contract correctly, but the contract is too narrow for reality.
>
> The reviewer's revised UX — collapsed **grabs** list per book, each expandable to its individual files, unlink the whole grab — requires a schema change. **#13 "Grabs: one download, multiple files"** owns resolving the new contract (schema + API + unlink semantics + canonical vocabulary). #08 reblocks on #13; the book-detail page prototype stays on `library/08-book-detail-prototype` as a reference for the resolution-shape #08 will adopt once #13 lands. UX decisions 1, 4, 5, 6 below (build fresh / loading+error / sidebar no-op / Kindle-line-inline) **stand** — they don't touch the grab model. UX decisions 2 (live API) and 3 (unlink-mid-flight UX) **carry forward** — they re-apply against the new grab-shape contract #13 produces.

**Resolved 2026-07-20** — prototype shipped on branch `library/08-book-detail-prototype`. Six #08-owned UX sub-decisions resolved through grilling, then the artifact built against the live #04/#06 API.

### Resolved #08-owned questions

1. **Extend `DetailsModal` vs build fresh** → **build fresh** `src/frontend/src/library/BookDetailPage.tsx`. `DetailsModal` is a portaled modal locked by `useBodyScrollLock` + `useEscapeKey` + `createPortal(document.body)` (`DetailsModal.tsx:60-61,435`) — modal idioms fight a URL-addressed routed page. New file reuses DetailsModal's content classes (`infoCardClass` / `infoLabelClass` / `infoValueClass`) as visual reference; DetailsModal is untouched and still opens from search results / release-list flow.
2. **Prototype fidelity: mock vs live #06 API** → originally recommended mock-first; **user overrode to live API**. The page calls `GET /api/library/books/:book_id` via plain `fetch` from `src/library/BookDetailPage.tsx:fetchBookDetail`. Verified end-to-end: seeded DB → Flask `:8084` → Vite `:5173` → `/library/10` returns real data. The contract module `src/library/types.ts` is typed to `library_routes.py:_serialize_book_detail` exactly so the page is the source of truth for the response shape.
3. **Unlink mid-flight UX** → **disallow with error** (user picked this over my recommended "allow with warning"). The DELETE returns 409 when `final_status='active'`; the UI greys Unlink on in-flight rows with tooltip "This download is in progress — unlink it after it finishes." Notable: under the canonical #04 response shape, in-flight rows live in the **`in_flight` array** (not the `files` array — they have no `download_path` yet), so the in-flight Unlink surface lives on the per-file table's in-flight sub-rows, not as a flag on completed rows. The prototype's canonical reading: the per-file list renders both `data.files` (completed, active Unlink) and `data.in_flight` (in-flight, disabled Unlink + tooltip).
4. **Loading & error states** → skeleton matching book-detail's two-column layout (cover placeholder block + metadata grid placeholders); error = inline card with Retry, URL preserved. Confirms #07's contract verbatim.
5. **Activity sidebar accessibility on library routes** → no-op. `ActivitySidebar` is mounted at `App.tsx:2664` as a sibling of `<main>` *inside* `mainAppContent`, so it renders on every authenticated route by construction. #07's nested `<Routes>` (added in App.tsx inside `<main>`) doesn't move the sidebar. Verified by inspection.
6. **Kindle-address surface placement** → inline under the Send-to-Kindle button, muted. Prototype reads `MOCK_KINDLE_EMAIL` shape from the per-user settings framework (#06's `KINDLE_EMAIL` setting); wired-up version in #11 swaps the static line for the resolved email value. Both states (email-set / email-unset) surface a clickable link to `SelfSettingsModal`. When unset, the Send button greys with tooltip "Set your Kindle email in Settings."

### Prototype render scope (all of #4/#5/#7/#8 in one page, against live API)

- Cover / title / author / subtitle / year / series / language / isbn / provider badge
- **Formats-on-disk union section** (one row per unique format via `unionFormats(files)`, Download button per row — stubbed with toast)
- **Per-file release-level list** (one row per `files[]` + one row per `in_flight[]`, with format/size/indexer/downloaded-at/Unlink button). In-flight rows render in an amber-tinted sub-row with a "in flight" pill and the disabled-tooltip Unlink.
- **Send-to-Kindle card** with override-picker popover. Default format per #05 (`KINDLE_FORMAT_PRIORITY=['epub']`); picker lists union formats on disk; "Auto" choice falls back to the algorithm. Greyed with tooltip when no Kindle-compatible format.
- **Find Releases** always-present surface at the bottom + empty-state persistent button (auto-opens on page load when `files_exist_globally == false` and `DEFAULT_LIBRARY_AUTO_FIND_RELEASES == true`).
- **In-flight indicator** above the header when `in_flight_globally == true`.
- **Loading skeleton** + **inline error retry** card (URL preserved). **NotFoundCard** for 404 / 403.
- All unverifiable onclicks surface a "prototype only" info toast through `onPrototypeAction` → `showToast(label, 'info')` so reviewers see what each button will wire to in #11.

### Artifact

- `src/frontend/src/library/BookDetailPage.tsx` — new component
- `src/frontend/src/library/LibraryPage.tsx` — `/library` placeholder stub (bookshelf grid still owned by #10)
- `src/frontend/src/library/types.ts` — type contract mirroring `_serialize_book_detail` + display helpers (`unionFormats`, `resolveKindleFormat`, `formatSize`)
- `src/frontend/src/App.tsx` — nested `<Routes>` mounted inside `mainAppContent` per #07 (replacing the prior `<SearchSection>` + `<ResultsSection>` flat sequence; those two are now element of `/`). `/library`, `/library/:bookId`, `*` → `<Navigate to="/" replace/>`
- `scripts/seed_library_prototype.py` — idempotent seed. Inserts a synthetic `users(id=0)` row (the admin-equivalent actor under `AUTH_METHOD=none`) so `user_library.user_id` FKs satisfy, then 3 books varying states.

### What worked

- **Live API wiring was the right call.** Mock would have hidden the canonical-shape bug: my initial mock had `in_flight?: boolean` as a flag on each `LibraryFile`. Reading `_serialize_book_detail` revealed in-flight rows live in a *separate* `in_flight[]` array (rows with no `download_path` aren't in `files[]`). The live API forced that canonical reading; mock would have let the non-canonical flag ship.
- **`useDependencyEffect` (the codebase's wrapper for `useEffect`) was necessary** — direct `useEffect` is lint-restricted (`react-hooks` rule), and the seed script discovered `LibraryService.add_to_library` requires `user_id > 0` which clashes with `AUTH_METHOD=none`'s `db_user_id=0` admin actor. The prototype surfaces this by reading raw from `user_library.user_id=0` rows (the FK constraint trick forced an explicit `users(0)` insert — surprising but cheap).
- **The activity sidebar stayed visible by construction on library routes** — confirms #07's contract; no per-route guard needed.

### What didn't work / what #11 should know

- **`in_my_library: false` reads as `False` under `AUTH_METHOD=none`** even when the user has a `user_library` row. The route calls `library_service.is_in_library(user_id=0, book_id=)` which `normalize_positive_int(0)` returns None for → False. The book-data fetch still succeeds for admin (gate on `actor.is_admin` short-circuits), but the `in_my_library: true` indicator reads false under auth-none in the prototype. Not a #08 defect — it's a property of the admin-equivalent auth mode. #11 should verify `in_my_library` against a real logged-in non-admin user to exercise the True path.
- **`downloadable_by_me: true` for all files under admin.** The #04 service marks every file downloadable when the actor is admin (`library_routes.py:387-391`). So the "not downloadable by me" state doesn't visibly exercise in the prototype (every file shows Download + Unlink). #11's real-user verification path will surface that state.
- **Send-to-Kindle doesn't actually send** — the button fires a prototype-only info toast. Wiring SMTP through #06's `send_file_to_email` is #11's scope.
- **Find Releases emits a prototype-only toast** — opening the existing `ReleaseModal` via `setReleaseBook` from inside `BookDetailPage` requires passing the setter down through props from `App.tsx` (where `activeReleaseBook` and `handleReleaseModalClose` live, `App.tsx:519`). Trivial when #11 lands but not prototyped here to avoid coupling to that state shape prematurely.
- **`KINDLE_EMAIL` is read from a mock constant** — the live per-user settings read is `app_config.get("KINDLE_EMAIL", "", user_id=actor.db_user_id)` (per `library_routes.py:523`). The frontend has no current surface that exposes per-user overriding settings; #11 will need to add a `GET /api/self/settings` shape or extend `/api/config`.tracked as a follow-up.
- **`LIBRARY_AUTO_FIND_RELEASES` env-var read** — the prototype hardcodes `DEFAULT_LIBRARY_AUTO_FIND_RELEASES = true`. The real env-var read happens server-side and would surface via `/api/config` — #11 wires that.

### Verification

- `make frontend-typecheck` clean.
- `make frontend-lint` clean (5 pre-existing errors in `useUsersFetch.ts` and `SelfSettingsModal.tsx` exist on `main`; not from #08).
- `make frontend-format` clean (via `frontend-format-fix`).
- Live seed + Flask + Vite chain confirmed: `GET /api/library/books/10` returns 3 files (EPUB×2 + MOBI, union EPUB+MOBI); `/11` returns empty state (auto-opens Find Releases); `/12` returns 1 complete EPUB + 1 in-flight AZW3 row.

### Unblocks

- **#11** (search/release-list integration) — now has the routed `/library/:bookId` page to land the Add-to-Library flow's navigation target, plus the prototype surface to extend.
- **#10** (bookshelf grid) — `/library` route exists as a placeholder; #10 replaces `LibraryPage.tsx` wholesale.
- **#09** (release-list dedup contract) — unaffected.
- **#12** (author browse MVP) — unaffected.

### Runbook for the reviewer

```sh
# one terminal — Flask backend
CONFIG_DIR=.local/config LOG_ROOT=/tmp INGEST_DIR=.local/books TMP_DIR=.local/tmp \
  uv run python -m shelfmark

# second terminal — Vite frontend (hot reload)
cd src/frontend && npm run dev

# third terminal — seed the prototype DB (idempotent; re-run anytime)
CONFIG_DIR=.local/config LOG_ROOT=/tmp uv run python scripts/seed_library_prototype.py
```

Then visit `http://localhost:5173/library/<id>` (id from the seed script's stdout):
- `/library/<id1>` — files-exist case (EPUB + MOBI on disk)
- `/library/<id2>` — empty state (auto-opens Find Releases via toast in this prototype)
- `/library/<id3>` — in-flight case (1 complete EPUB + 1 in-flight AZW3 row with disabled Unlink tooltip)
- `/library/9999` — NotFoundCard state

## Carry-forward to #08's second resolution pass (post-#13)

When #08 picks up against the #13-resolved grab contract, the following #08-owned UX decisions **stand unchanged** and don't need re-grilling:

1. **Build fresh `BookDetailPage.tsx`** (`src/frontend/src/library/`) — applies to the revised grab-shaped page too.
4. **Loading skeleton + inline retry card**, URL preserved (confirms #07).
5. **Activity sidebar: no-op**, stays mounted by construction.
6. **Kindle-email surface inline under the Send button**, link to `SelfSettingsModal`.

The following #08-owned UX decisions **carry forward but re-apply against #13's new contract**:

2. **Live #06 API, not mock.** Re-applies to the revised `_serialize_book_detail` shape #13 produces.
3. **Unlink mid-flight: disallow with error.** The UX-flat rule stands; #13 owns re-applying it at the grab level (the whole grab is in-flight → disallow unlink).

Two new UX surfaces emerge from the reviewer's revised page shape that #08 will then need to grill:

- **Collapsed-grabs list** — one expandable row per grab; expanding shows the grab's individual files with per-file download buttons. This is new territory the first pass of #08 didn't cover (it rendered per-file flat, not grab-grouped).
- **Book details modal** (rating, series, readers, year, description) — opens from the book-detail page. Today the existing `DetailsModal` renders `display_fields` for Universal-mode search results from in-memory data (the search-result row), not from the Library API. The book-detail page needs `display_fields` to come from `metadata_json` provider-by-provider, OR from a #04 API extension that adds `display_fields` to `_serialize_book_detail`. #13 may or may not own this; could be a separate fog patch.

The find-releases auto-open behaviour on empty-state, the Send-to-Kindle override picker, the in-flight indicator at the top — all re-apply against the new shape too.
