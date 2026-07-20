Type: grilling
Status: open
Blocked by: 04

# Grabs: one download, multiple files

## Question

Resolve the schema + API contract + canonical vocabulary for a **grab** — a single download activity that produces multiple files on disk — and a forward path to model it correctly across `download_history`, `download_history_service`, the #04 library API, the #06 routes, the seed/test fixture, and the `transfer_book_files` caller that today silently discards every file but the first.

## Origin (fact-finding from reviewer feedback on #08)

**Reviewer intuition was correct.** A single torrent download produces multiple matched book files (often EPUB + MOBI + PDF from one grab). Reviewer observed: "I have confirmed a single download imported three files and the torrent also contained those three files." The current #04/#06 contract and #01's `CONTEXT.md` schema both model `download_history` as **one row = one file = one format** — factually too narrow.

### What the code actually does

- `shelfmark/download/postprocess/transfer.py:161 transfer_book_files(book_files: list[Path], ...)` transfers **all** matched book files into the destination dir. The list `final_paths[]` it builds contains every transferred file (`transfer.py:179-267`).
- The caller of `transfer_book_files` (in the same module's `process_*_files` flow, `transfer.py:416-451`) iterates `len(source_files) > 1`, hardlinking/copying/moving each one to its final destination, building `transferred_paths: list[Path]`.
- `shelfmark/download/postprocess/transfer.py:478`: returns `str(transferred_paths[0])` — **discards every file but the first.** `transfer.py:371` does the same for the simpler case.
- `shelfmark/main.py:1435-1454 _record_download_terminal_snapshot` calls `download_history_service.finalize_download(task_id, final_status, status_message, download_path=task.download_path, retry_payload=...)` — that one path is persisted to `download_history.download_path`. `download_history.format` was set at queue time from `task.format` (singular) — also collapses to one format for a multi-format grab.

### What the schema today stores

`download_history` (`shelfmark/core/user_db.py:70-91`):

- `task_id TEXT UNIQUE NOT NULL` — the grab's identity (one per download activity).
- `format TEXT` — singular format; intended by #01 to be the file's format.
- `size TEXT` — singular size.
- `download_path TEXT` — singular path.
- `book_id INTEGER` (added by #03's migration) — FK to `books.id`.
- `final_status TEXT NOT NULL` — `'active'` for in-flight, `'complete'` for terminal.

There's **no concept of multiple files per grab** anywhere in the schema. `library_service.get_files_on_disk` (`library_service.py:285`) `SELECT`s one row → one `<file>` entry in `_serialize_book_detail`'s `files[]` array (`library_routes.py:192-203`). The #04 contract that the #08 prototype modelled correctly against is **factually lossy versus reality**.

## Open questions this ticket must resolve

Open under five headings — schema, finalize-time persistence, API contract, unlink semantics, vocabulary. The grilling session works each in dependency order (schema is upstream of everything).

1. **Schema shape — child table or repurpose `task_id`?**
   - **(a) New `download_history_files` child table** keyed by `download_history.id` (FK `ON DELETE CASCADE`): columns `id, history_id, format, size, path, transferred_op, indexed_at`. One row per file. `download_history.format`/`size`/`download_path` become **summary** columns (first file's format; aggregate size; first file's path — preserves the current API surface for any consumer reading the flat row directly). Bonus: `format` becomes "primary format" rather than singular, and the formats-union across a book's `download_history` rows stays derivable from the child table.
   - **(b) Re-purpose `download_history` to one-row-per-file** with a new `grab_id` grouping column (the old `task_id` becomes `grab_id`; one grab spans multiple rows sharing the same `grab_id`). Touches every caller of `download_history` (activity sidebar, history views, retry-backfill, etc. — far heavier than (a)).
   - **(c) Keep schema flat, accept the loss** — officially cap the system at one file per grab. Means the pipeline silently drops N-1 files from `download_history`, and Find Downloads dedup by `(source, task_id)` is the only surviving concept. Reviewer explicitly disagreed with this option when raising the feedback.

2. **Finalize-time write path — where the child rows get persisted.**
   The natural seam: `transfer_book_files` returns `final_paths[]` (already does — `transfer.py:171,237,270,302`). The bug is the caller at `transfer.py:478` returning `transferred_paths[0]`. The pipeline needs to surface *all* `transferred_paths` up to whoever calls `finalize_download` so a new `record_download_files(history_id, paths[])` call can insert the child rows. Is the seam at `transfer.py:478` (let `process_*_files` return `list[Path]` instead of `str`), or at `_record_download_terminal_snapshot` (extend the snapshot to carry a list)? #13 decides the shape.

3. **API contract — `_serialize_book_detail` shape.**
   Today (#04): `files[]` is one entry per `download_history` row, with `{history_id, format, size, indexer_display_name, protocol, downloaded_at, downloadable_by_me}`. Resolution (a) above reshapes to: `files[]` becomes `grabs[]` (reviewer's preferred term), one entry per `download_history` row with the summary fields plus a nested `files: [{format, size, path, downloaded_at, downloadable_by_me}]` array per row. `downloadable_by_me` per-file (because `user_downloads` owns grabs, not individual files — sub-decision linked below). `in_flight[]` follows the same re-shape.

4. **Unlink semantics — at the grab level.**
   - Reviewer's stated intention: "unlink an entire release (= grab)." Unlink at the grab level means `DELETE /api/library/books/:book_id/downloads/:history_id` (existing #04 route, unchanged endpoint shape) deletes the `user_downloads` link row — same as today — but now the *visual* meaning is "remove the whole grab from my library." The underlying `download_history` row + its `download_history_files` children stay untouched (per #04 sub-decision 7: "file/`download_history` row untouched"). The files stay on disk globally; other users still see the grab if they've linked it.
   - **Per-file unlink mid-flight:** the #08-decided-rule was "disallow with error when `final_status='active'`." Under the new grab-shape, what if the grab is multi-file and one file in it is mid-transfer? Today the whole `download_history` row's `final_status` flips to `'complete'` only after the pipeline finishes transferring all files; mid-flight means the row's `final_status='active'`. So "unlink mid-flight" = the whole grab is mid-flight = the row-level rule still holds. **#13 reaffirms the rule applies at the row level** (it always did, but explicitly noting it for the new grab shape).
   - **No per-file unlink:** the contract does **not** expose unlink of individual files within a grab — `user_downloads` owns grabs, not files. If a user wants to keep one file of a grab and not another, that's out of scope for this effort (would require a separate per-file link table).

5. **Canonical vocabulary — "grab" vs "release."**
   Reviewer proposed "grab" because "release" overlaps with the upstream indexer's vocabulary (`release` is one row in the search results; one search result can map to one grab). The map body and CONTEXT.md say "release" throughout (#02 "Find Releases," #04 sub-decision 1 "release-level metadata," #09 "release-list dedup," #11 "release-list integration"). Decide:
   - **(a)** Adopt `grab` as canonical for the *post-download artefact* (one `download_history` row + its child files). Keep `release` for the *upstream search/indexer row* (the search-result rows the user picks from). Two distinct terms, precise.
   - **(b)** Keep `release` everywhere (overloaded term).
   - **(c)** Adopt `grab` everywhere; rename `Find Releases` to `Find Grabs` on the search side (touches more surface).

## Out of scope (must rule out)

- **Per-file unlink within a grab.** Grabs are unlinked atomically. Out of scope for this effort; surfaces only if a reviewer explicitly asks for per-file ownership.
- **Migration of legacy download_history rows.** Existing rows that pre-date #13 carry only the primary file's path + format. The migration adds the `download_history_files` child row from the existing `download_path` + `format` — that's the floor; the other N-1 files of legacy grabs are *truly lost* (the destination dir may or may not still hold them; scanning is out of scope).
- **Retroactive scanning of destination dirs to backfill missing child files.** Out of scope — lands as a fresh effort if a reviewer asks for it later. The map updates its Out-of-scope section to record this ruling once #13 resolves.

## What #13 produces

A **contract decision** (this is a grilling ticket, not an implementation ticket) that resolves all five headings above, plus a context pointer back to the map. It does *not* write the migration or the implementation — those land as the *outcome* of #13's decision, owned either by #03-extend (a fresh implementation ticket) or by the existing #11 (which already touches download-finalize → user_downloads wiring). #13's resolution explicitly nominates which ticket picks up the implementation.

## Linked artifacts

- `shelfmark/download/postprocess/transfer.py:161,302,478` — the source of truth for "one grab, multiple files"
- `shelfmark/main.py:1376,1435` — the queue-time + terminal-time history writers
- `shelfmark/core/download_history_service.py:344` — `finalize_download` writes one path
- `shelfmark/core/library_service.py:285` — `get_files_on_disk` reads from one history row
- `shelfmark/core/library_routes.py:170` — `_serialize_book_detail` shape (the contract #13 reshapes)
- `shelfmark/core/user_db.py:70-91` — the `download_history` schema (one row = one file today)
- `.scratch/library/issues/08-book-detail-page-ui.md` (reopened) — the prototype that surfaced this gap; #13 unblocks #08's revision
- `CONTEXT.md` (File / Download section, plus the new Grab term — pending decision)
