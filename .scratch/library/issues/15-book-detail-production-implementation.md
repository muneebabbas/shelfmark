Type: task
Status: claimed
Blocked by: 06, 07, 08, 14

# Implement the validated book detail UI

## Question

Promote the validated contract from [Book detail page UI (with per-format downloads and Send-to-Kindle)](08-book-detail-page-ui.md) into production-quality code on a new feature branch. Do not merge or polish the prototype branch directly.

Use `library/08-book-detail-prototype-reconciled` at `dfc2b4e` as the visual and interaction reference, then reimplement it against a branch containing #14's multi-file release contract. Production work includes the nested `/library/:bookId` route and live handlers for per-format download, exact-file download, release-atomic unlink, Send-to-Kindle, settings, and Find Releases. Preserve #08's two-level information hierarchy:

- Available formats: newest completed File per format by `downloaded_at`, then `history_id`, with compact source/date provenance.
- Releases: collapsed advanced `task_id` groups, exact-file download, and a clearly release-wide unlink action.

The prototype's info-toast mutation stubs, artificial loading latency, and old tracker state must not be carried forward. The implementation must use the app's existing error/loading patterns and keep the activity sidebar accessible per #07.

Verification: `make checks` passes; seed or fixture data covers multi-file releases; `/library/1`, `/library/2`, and `/library/3` exercise the available-formats, empty, and in-flight paths; live mutations hit their #04/#06 endpoints.
