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
