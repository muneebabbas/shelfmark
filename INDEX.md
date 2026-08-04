# Index: navigating the Shelfmark codebase

A high-level map of the repository. Use this to find where a feature lives
before opening files. Paths are relative to the repo root. Stable by design —
prefer adding a pointer here over duplicating feature details.

## Manuals / docs

| Topic | Where |
|-------|-------|
| Domain glossary & ubiquitous language (Book, Library, Capability, …) | [`CONTEXT.md`](CONTEXT.md) |
| Architecture decisions (ADRs) | [`docs/adr/`](docs/adr) |
| Deployment configuration reference | [`docs/configuration.md`](docs/configuration.md) |
| Every environment variable | [`docs/environment-variables.md`](docs/environment-variables.md) |
| Users, authentication & request policies | [`docs/users-and-requests.md`](docs/users-and-requests.md) |
| OIDC / proxy / Calibre-Web auth | [`docs/oidc.md`](docs/oidc.md) |
| Reverse-proxy & URL/search params | [`docs/reverse-proxy.md`](docs/reverse-proxy.md), [`docs/url-search-parameters.md`](docs/url-search-parameters.md) |

## User requests and approvals

How downstream users discover, request, and get approval for books.

- Request policy modes (download / request-release / request-book / blocked),
  per-source rules and per-user overrides, lifecycle — [`docs/users-and-requests.md`](docs/users-and-requests.md),
  backend logic in [`shelfmark/core/requests_service.py`](shelfmark/core/requests_service.py),
  [`shelfmark/core/request_routes.py`](shelfmark/core/request_routes.py),
  [`shelfmark/core/request_validation.py`](shelfmark/core/request_validation.py).
- Notifications for users/admins — [`shelfmark/core/notifications.py`](shelfmark/core/notifications.py),
  [`shelfmark/config/notifications_settings.py`](shelfmark/config/notifications_settings.py).
- User models / auth identity / per-user settings — [`shelfmark/core/user_db.py`](shelfmark/core/user_db.py),
  [`shelfmark/core/auth_modes.py`](shelfmark/core/auth_modes.py),
  [`shelfmark/core/external_user_linking.py`](shelfmark/core/external_user_linking.py),
  [`shelfmark/core/cwa_user_sync.py`](shelfmark/core/cwa_user_sync.py).
- Frontend request flows — [`src/frontend/src/library/`](src/frontend/src/library),
  [`src/frontend/src/hooks/useRequests.ts`](src/frontend/src/hooks/useRequests.ts).

## Library & automatic detection of relevant files

Adding Books to a user's Library, then automatically matching a downloaded
release's files to Book requests (no manual per-file mapping).

- Library model: Book (denormalized provider snapshot), `user_library`,
  `user_downloads` links — [`CONTEXT.md`](CONTEXT.md), ADRs in [`docs/adr/`](docs/adr).
- Library service & routes — [`shelfmark/core/library_service.py`](shelfmark/core/library_service.py),
  [`shelfmark/core/library_routes.py`](shelfmark/core/library_routes.py).
- Import activities & their lifecycle — [`shelfmark/core/import_activity_service.py`](shelfmark/core/import_activity_service.py),
  [`shelfmark/core/activity_routes.py`](shelfmark/core/activity_routes.py),
  [`shelfmark/core/activity_view_state_service.py`](shelfmark/core/activity_view_state_service.py).
- Auto-selecting release members for a Book — [`shelfmark/core/member_matcher.py`](shelfmark/core/member_matcher.py).
- Frontend: bookshelf, book detail, add-to-library, search — [`src/frontend/src/library/`](src/frontend/src/library).

## Storage layout of actual epub/downloaded files

How a downloaded file is persisted and made visible.

- Post-download destination pipeline — [`shelfmark/download/postprocess/`](shelfmark/download/postprocess).
- Download orchestration, queue, download clients — [`shelfmark/download/orchestrator.py`](shelfmark/download/orchestrator.py),
  [`shelfmark/core/queue.py`](shelfmark/core/queue.py),
  [`shelfmark/download/clients/`](shelfmark/download/clients).
- File rows & `download_history` model — [`shelfmark/core/user_db.py`](shelfmark/core/user_db.py),
  [`shelfmark/core/download_history_service.py`](shelfmark/core/download_history_service.py).
- Output modes (folder / email / BookLore) — [`shelfmark/download/outputs/`](shelfmark/download/outputs).

## Sources, metadata & discovery

- Metadata providers (Hardcover, Open Library, Google Books) — [`shelfmark/metadata_providers/`](shelfmark/metadata_providers).
- Release sources (Prowlarr, Newznab, IRC, AudiobookBay, direct) — [`shelfmark/release_sources/`](shelfmark/release_sources).

## Configuration, auth & admin

- Settings registry & handlers — [`shelfmark/config/`](shelfmark/config),
  [`shelfmark/core/settings_registry.py`](shelfmark/core/settings_registry.py).
- Admin operations (incl. release deletion) — [`shelfmark/core/admin_routes.py`](shelfmark/core/admin_routes.py).
- Auth modes, OIDC, security — [`shelfmark/core/auth_modes.py`](shelfmark/core/auth_modes.py),
  [`shelfmark/core/oidc_auth.py`](shelfmark/core/oidc_auth.py),
  [`shelfmark/core/security.py`](shelfmark/core/security.py) (config/security.py).

## Frontend (React + Vite)

- Entry, routing, global state — [`src/frontend/src/App.tsx`](src/frontend/src/App.tsx),
  [`src/frontend/src/main.tsx`](src/frontend/src/main.tsx).
- Reusable UI components & settings forms — [`src/frontend/src/components/`](src/frontend/src/components).
- Library screens & shared core styles — [`src/frontend/src/library/`](src/frontend/src/library),
  [`src/frontend/src/styles.css`](src/frontend/src/styles.css).

## Tests, tooling, scripts

- Python & frontend test suites — [`tests/`](tests), [`src/frontend/src/tests/`](src/frontend/src/tests).
- Dev/build tasks — [`Makefile`](Makefile); local library seed — [`scripts/seed_library_demo.py`](scripts/seed_library_demo.py).
- Docker / deployment — [`compose/`](compose), [`Dockerfile`](Dockerfile), [`entrypoint.sh`](entrypoint.sh).

---

Shelfmark is a community project — if something here is wrong or missing, report
it at [github.com/muneebabbas/shelfmark/issues](https://github.com/muneebabbas/shelfmark/issues).
