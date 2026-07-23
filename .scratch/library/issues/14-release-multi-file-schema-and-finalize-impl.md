Type: task
Status: claimed
Blocked by: 13
Assignee: glm-5.2-fast (claimed 2026-07-23)

# Implement #13's multi-file release schema + finalize write path

## Question

Implement the contract #13 resolved: `download_history` as one-row-per-file (one `task_id` shared across files of the same release), multi-file finalize, flat `files[]` + `task_id` API, release-atomic unlink, finalize-time `user_downloads` linking. #13 is the contract decision; #14 is the implementation. #13's Answer is the authoritative spec — read it in full before starting.

## Scope (per #13's "Implementation owner nomination")

1. **Schema migration** (`user_db.py`, #03's conditional `PRAGMA table_info`/`index_info` idiom): drop `UNIQUE` on `download_history.task_id` (sqlite table rebuild — copy rows to temp, drop+recreate without UNIQUE, copy back). Add a non-unique index on `task_id` (`idx_download_history_task_id`). Legacy rows keep their existing values; no backfill.
2. **Transfer return types** (`shelfmark/download/postprocess/transfer.py`):
   - `transfer_file_to_library` (`:371`): return `list[Path]` instead of `str(final_path)`.
   - `transfer_directory_to_library` (`:478`): return `list[Path]` instead of `str(transferred_paths[0])`.
   - `transfer_book_files` (`:161-270`) already returns `list[Path]` — unchanged.
   - Audit and update every caller of the two changed functions.
3. **Task carrier**: add `task.library_paths: list[str]` to `DownloadTask`. Set it from the transfer return list (stringified). Keep `task.download_path = str(library_paths[0])` for any legacy single-path reader.
4. **`download_history_service.finalize_download_files(task_id, file_rows)`** — new method:
   - Delete the `'active'` sentinel row for `task_id`.
   - Insert N file rows (one per `(path, format, size)` in `file_rows`) with `final_status` + `terminal_at` set, sharing the same `task_id`.
   - Insert N `user_downloads(user_id, history_id)` rows for the triggering user (`download_history.user_id` of the sentinel) — one per inserted file row.
   - Atomic (single `with self._lock` + `conn.commit()`).
   - `finalize_download` (existing) becomes a thin delegate that calls `finalize_download_files` with a one-element list — preserves call signature for non-library callers.
5. **`record_download` retry path** (`download_history_service.py:313-318`): replace `ON CONFLICT(task_id) DO UPDATE SET final_status='active'...` with explicit `DELETE FROM download_history WHERE task_id=?` + sentinel `INSERT` (per-file cols NULL) inside the existing `with self._lock` transaction. Atomic.
6. **`_record_download_terminal_snapshot`** (`main.py:1435`): read `task.library_paths` (the list) instead of `task.download_path`; build `file_rows` from it (derive `format`/`size` per file at the path — plumbing, see existing `transfer_book_files` for how per-file `format` is derived from the source extension). Call `finalize_download_files`.
7. **`_serialize_book_detail`** (`library_routes.py:170-212`): add `task_id` to each entry in `files[]` and `in_flight[]`. No shape change beyond the added field.
8. **Unlink service** (`library_service.py`): the `DELETE /api/library/books/:book_id/downloads/:history_id` handler looks up the row's `task_id`, finds all sibling file rows sharing it, and deletes `user_downloads` links for all of them for the requesting user (release-atomic). Per-file unlink stays impossible.
9. **`CONTEXT.md`**: File section is already updated (per #13's resolution). Verify no drift.
10. **Tests**: cover multi-file finalize (N=3 file rows + N `user_downloads` links inserted), retry-while-partial (multi-file rows from crashed attempt deleted before sentinel insert), per-file `task_id` present in `files[]` API payload (multiple entries share `task_id`), release-atomic unlink fan-out (one `:history_id` deletes N links), mid-flight unlink returns 404 (no link row yet), sentinel shape at queue time (per-file cols NULL), legacy single-file rows still work (one-member release group).
11. **#08 revision (post-implementation)**: update `library/08-book-detail-prototype` against the new flat `files[] + task_id` shape. The frontend groups by `task_id` for display. Out of #14's scope unless #08 is still claimed by the same dev — hand off to #08 otherwise.

## Out of scope (per #13)

- Per-file unlink within a release (releases unlinked atomically).
- Destination-dir scanning to backfill missing files of legacy grabs.
- Migration of legacy rows beyond dropping UNIQUE — legacy rows keep their existing single-file shape trivially.
- A "Grab" vocabulary term (#13 chose "release" everywhere).
- `grabs[]` server-side API grouping (#13 chose flat `files[]` + `task_id`).

## Definition of done

- `make python-checks` green; new tests pass; existing library API tests still pass (the `files[]` shape gains a field, doesn't lose any).
- `_serialize_book_detail` payload includes `task_id` per entry; a multi-file grab produces N entries sharing the same `task_id`.
- Unlinking a release with N files deletes all N `user_downloads` links for the user.
- Mid-flight unlink returns 404.
- Map's Decisions-so-far gets a #14 context pointer on close; unblocks #08 (blocked by 13), #11 (blocked by 13).
