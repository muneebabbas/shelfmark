"""Library API routes — per-user ebook library per ticket #04's contract.

Routes live in this module registered via ``register_library_routes`` —
matches the project's existing ``register_*_routes`` convention
(activity_routes, request_routes, admin_routes, self_user_routes). Not a
Flask Blueprint — none exists in the codebase today.

Ownership rules enforce #04 sub-decisions:
- File serving gates on ``user_library`` membership (NOT ``download_history.user_id``)
  (sub-decision 7) — closes the existing cross-user byte-exposure leak.
- Admin scoping: self-scoped by default, with an explicit instance-wide read.

"""

from __future__ import annotations

import sqlite3
import uuid
from pathlib import Path
from typing import TYPE_CHECKING, Any, NamedTuple

from flask import Flask, Response, jsonify, request, send_file, session

from shelfmark.core.config import config as app_config
from shelfmark.core.logger import setup_logger
from shelfmark.core.naming import sanitize_filename
from shelfmark.core.request_helpers import (
    get_session_db_user_id,
    normalize_optional_text,
    normalize_positive_int,
)

if TYPE_CHECKING:
    from collections.abc import Callable

    from shelfmark.core.download_history_service import DownloadHistoryService
    from shelfmark.core.import_activity_service import ImportActivityService
    from shelfmark.core.library_service import LibraryService
    from shelfmark.core.user_db import UserDB

logger = setup_logger(__name__)

_USER_DB_IDENTITY_ERRORS = (sqlite3.Error, OSError)
_OPERATIONAL_ERRORS = (OSError, RuntimeError, TypeError, ValueError, sqlite3.Error)
_LIBRARY_PROVIDER_ERRORS = (OSError, RuntimeError, TypeError, ValueError, sqlite3.Error)


class _ActorContext(NamedTuple):
    db_user_id: int
    is_admin: bool
    owner_scope: int | None
    library_capability: str


def _book_attachment_name(*, book: dict[str, Any] | None, book_id: int, download_path: str) -> str:
    """Return a safe Book-derived attachment name without renaming the artifact."""
    title = normalize_optional_text(book.get("title")) if book else None
    author = normalize_optional_text(book.get("author")) if book else None
    stem = title or f"Book {book_id}"
    if author:
        stem = f"{stem} - {author}"

    suffix = Path(download_path).suffix
    safe_stem = sanitize_filename(stem, max_length=max(1, 245 - len(suffix)))
    return f"{safe_stem or f'Book {book_id}'}{suffix}"


type LibraryRouteResponse = tuple[Response, int]
type ActorResolution = tuple[_ActorContext | None, LibraryRouteResponse | None]


def _require_authenticated(
    resolve_auth_mode: Callable[[], str], *, action: str
) -> LibraryRouteResponse | None:
    auth_mode = resolve_auth_mode()
    if auth_mode == "none":
        return None
    if "user_id" not in session:
        logger.warning("Library %s rejected: status=401 reason=unauthorized", action)
        return jsonify({"error": "Unauthorized"}), 401
    return None


def _resolve_library_actor(
    *,
    user_db: UserDB,
    resolve_auth_mode: Callable[[], str],
    action: str,
) -> ActorResolution:
    """Resolve acting user identity for library operations.

    Auth-mode "none" is admin-equivalent (matches activity_routes' NOAUTH_VIEWER_SCOPE).
    """
    auth_mode = resolve_auth_mode()
    if auth_mode == "none":
        return _ActorContext(
            db_user_id=0,
            is_admin=True,
            owner_scope=None,
            library_capability="download-capable",
        ), None

    raw_db_user_id = get_session_db_user_id(session)
    if raw_db_user_id is None:
        logger.warning("Library %s rejected: missing db_user_id", action)
        return None, (jsonify({"error": "Forbidden"}), 403)

    try:
        db_user_id = int(raw_db_user_id)
    except TypeError, ValueError:
        logger.warning("Library %s rejected: invalid db_user_id=%r", action, raw_db_user_id)
        return None, (jsonify({"error": "Forbidden"}), 403)
    if db_user_id < 1:
        return None, (jsonify({"error": "Forbidden"}), 403)

    try:
        db_user = user_db.get_user(user_id=db_user_id)
    except _USER_DB_IDENTITY_ERRORS as exc:
        logger.warning("Library %s rejected: user lookup failed: %s", action, exc)
        return None, (jsonify({"error": "Forbidden"}), 403)
    if db_user is None:
        return None, (jsonify({"error": "Forbidden"}), 403)

    is_admin = bool(session.get("is_admin"))
    return _ActorContext(
        db_user_id=db_user_id,
        is_admin=is_admin,
        owner_scope=db_user_id,
        library_capability=str(db_user["library_capability"]),
    ), None


def _require_library_membership(
    *,
    actor: _ActorContext,
    library_service: LibraryService,
    book_id: int,
    action: str,
) -> LibraryRouteResponse | None:
    """Gate file serving & send-to-kindle on user_library membership (sub-decision 7).

    Admin sees any book (instance-wide read per sub-decision 2). Non-members
    get 403 — including for books with files they triggered but didn't keep
    linked. The dedicated library download endpoint is the only path that
    serves file bytes.
    """
    if actor.is_admin:
        return None
    if library_service.is_in_library(user_id=actor.db_user_id, book_id=book_id):
        return None
    logger.warning(
        "Library %s rejected: status=403 book_id=%s actor=%s reason=not_in_library",
        action,
        book_id,
        actor.db_user_id,
    )
    return jsonify({"error": "Forbidden"}), 403


def _error_response(
    *,
    action: str,
    status_code: int,
    error: str,
    book_id: int | None = None,
) -> LibraryRouteResponse:
    logger.warning(
        "Library %s rejected: status=%s book_id=%s reason=%s",
        action,
        status_code,
        book_id,
        error,
    )
    return jsonify({"error": error}), status_code


def _normalize_book_id_param(raw: Any) -> int | None:
    return normalize_positive_int(raw)


def _parse_pagination_params() -> tuple[int, int] | None:
    raw_limit = request.args.get("limit")
    raw_offset = request.args.get("offset")
    try:
        limit = 25 if raw_limit is None else int(raw_limit)
        offset = 0 if raw_offset is None else int(raw_offset)
    except ValueError:
        return None
    if not 1 <= limit <= 100 or offset < 0:
        return None
    return limit, offset


def _serialize_book_summary(book: dict[str, Any], *, library_added_at: Any) -> dict[str, Any]:
    """Per #04 route table: GET /api/library/books response shape."""
    return {
        "book_id": book["id"],
        "title": book.get("title"),
        "author": book.get("author"),
        "cover_url": book.get("cover_url"),
        "formats_on_disk": [],  # filled by caller with union of file list
        "added_at": library_added_at,
        "is_unassigned": bool(book.get("is_unassigned", False)),
    }


def _torrent_path(download_path: Any, mapping: dict[str, str]) -> Any:
    """Return the torrent-relative path for a file, falling back to on-disk path."""
    if download_path is None:
        return None
    return mapping.get(download_path) or download_path


def _derived_epub_status(artifact: dict[str, Any]) -> str:
    """Expose ready only when the stored artifact remains validated and present."""
    if artifact["status"] != "ready":
        return str(artifact["status"])
    path = normalize_optional_text(artifact.get("artifact_path"))
    if artifact["validation_result"] == "valid" and path and Path(path).is_file():
        return "ready"
    return "unavailable"


def _serialize_book_detail(
    book: dict[str, Any],
    *,
    files: list[dict[str, Any]],
    in_flight: list[dict[str, Any]],
    downloadable_history_ids: set[int],
    relative_paths_by_output: dict[str, str],
    derived_epub_by_history_id: dict[int, dict[str, Any]],
) -> dict[str, Any]:
    """Per #04 route table: GET /api/library/books/:book_id response shape.

    Each file exposes ``torrent_path``, the path as it appeared inside the
    original torrent (derived from the retained source member's
    ``relative_path``), falling back to the on-disk ``download_path`` when no
    source provenance is available.
    """
    return {
        "book_id": book["id"],
        "metadata_provider": book.get("metadata_provider"),
        "provider_book_id": book.get("provider_book_id"),
        "title": book.get("title"),
        "author": book.get("author"),
        "subtitle": book.get("subtitle"),
        "publish_year": book.get("publish_year"),
        "isbn_13": book.get("isbn_13"),
        "cover_url": book.get("cover_url"),
        "series_name": book.get("series_name"),
        "series_position": book.get("series_position"),
        "language": book.get("language"),
        "metadata_json": book.get("metadata_json") or {},
        "files": [
            {
                "history_id": f["id"],
                "task_id": f.get("task_id"),
                "import_activity_id": f.get("import_activity_id"),
                "format": f.get("format"),
                "size": f.get("size"),
                "indexer_display_name": f.get("source_display_name") or f.get("source"),
                "protocol": f.get("content_type"),
                "is_manual_upload": f.get("source") == "manual",
                "downloaded_at": f.get("terminal_at"),
                "download_path": (
                    Path(str(f.get("download_path") or "")).name
                    if f.get("source") == "manual"
                    else f.get("download_path")
                ),
                "torrent_path": (
                    None
                    if f.get("source") == "manual"
                    else _torrent_path(f.get("download_path"), relative_paths_by_output)
                ),
                "downloadable_by_me": int(f["id"]) in downloadable_history_ids,
                **(
                    {"derived_epub": derived_epub_by_history_id[int(f["id"])]}
                    if int(f["id"]) in derived_epub_by_history_id
                    else {}
                ),
            }
            for f in files
        ],
        "in_flight": [
            {
                "history_id": f["id"],
                "task_id": f.get("task_id"),
                "format": f.get("format"),
                "source_display_name": f.get("source_display_name") or f.get("source"),
            }
            for f in in_flight
        ],
    }


def register_library_routes(
    app: Flask,
    user_db: UserDB,
    *,
    library_service: LibraryService,
    download_history_service: DownloadHistoryService,
    resolve_auth_mode: Callable[[], str],
    resolve_metadata_book: Callable[[str, str], dict[str, Any] | None],
    cancel_download: Callable[[str], bool],
    clear_completed_download: Callable[[str], bool],
    import_activity_service: ImportActivityService | None = None,
    storage_root: Path | None = None,
    hardlink_torrents: bool = False,
) -> None:
    """Register library API routes.

    Args:
        app: Flask app.
        user_db: User database (for actor resolution).
        library_service: Library data-layer service.
        download_history_service: Download history service (for path resolution).
        resolve_auth_mode: Returns the active auth mode ("none"/"builtin"/...).
        resolve_metadata_book: Resolves ``(provider, provider_book_id)`` to a
            metadata dict (#04 sub-decision 13) — invoked at Add time. Returns
            ``None`` when the provider is unavailable. The route translates a
            ``None`` into a 503.

    """

    def _actor_gate(action: str) -> Response | LibraryRouteResponse | _ActorContext:
        auth_gate = _require_authenticated(resolve_auth_mode, action=action)
        if auth_gate is not None:
            return auth_gate
        actor, actor_error = _resolve_library_actor(
            user_db=user_db, resolve_auth_mode=resolve_auth_mode, action=action
        )
        if actor_error is not None:
            return actor_error
        if actor is None:  # Defensive — _resolve_library_actor always returns one or the other.
            return _error_response(action=action, status_code=500, error="Internal Server Error")
        return actor

    def _membership_or_403(
        actor: _ActorContext, book_id: int, action: str
    ) -> LibraryRouteResponse | None:
        return _require_library_membership(
            actor=actor, library_service=library_service, book_id=book_id, action=action
        )

    def _admin_or_403(
        actor: _ActorContext, *, action: str, book_id: int
    ) -> LibraryRouteResponse | None:
        if actor.is_admin:
            return None
        return _error_response(
            action=action, status_code=403, error="Admin required", book_id=book_id
        )

    @app.route("/api/library/books", methods=["POST"])
    def api_library_add_book() -> Response | LibraryRouteResponse:
        action = "add_book"
        gate = _actor_gate(action)
        if isinstance(gate, _ActorContext):
            actor = gate
        else:
            return gate

        data = request.get_json(silent=True)
        if not isinstance(data, dict):
            return _error_response(action=action, status_code=400, error="Invalid payload")

        metadata_provider = normalize_optional_text(data.get("metadata_provider"))
        provider_book_id = normalize_optional_text(data.get("provider_book_id"))
        if not metadata_provider or not provider_book_id:
            return _error_response(
                action=action,
                status_code=400,
                error="metadata_provider and provider_book_id are required",
            )

        try:
            metadata_payload = resolve_metadata_book(metadata_provider, provider_book_id)
        except _LIBRARY_PROVIDER_ERRORS as exc:
            logger.warning("Library add_book metadata fetch failed: %s", exc)
            return jsonify({"error": "Metadata provider unavailable"}), 503
        if metadata_payload is None:
            return jsonify({"error": "Metadata provider unavailable"}), 503

        try:
            book = library_service.upsert_book_from_metadata(
                metadata_provider=metadata_provider,
                provider_book_id=provider_book_id,
                title=metadata_payload["title"],
                author=metadata_payload.get("author"),
                subtitle=metadata_payload.get("subtitle"),
                publish_year=metadata_payload.get("publish_year"),
                isbn_13=metadata_payload.get("isbn_13"),
                cover_url=metadata_payload.get("cover_url"),
                series_name=metadata_payload.get("series_name"),
                series_position=metadata_payload.get("series_position"),
                language=metadata_payload.get("language"),
                metadata_json=metadata_payload.get("metadata_json") or {},
            )
            library_service.add_to_library(user_id=actor.db_user_id, book_id=int(book["id"]))
        except _OPERATIONAL_ERRORS as exc:
            logger.error_trace(
                "Library add_book failed",
                extra={"action": "add_book", "user_id": actor.db_user_id, "exc": exc},
            )
            return jsonify({"error": "Internal server error"}), 500

        book_id = int(book["id"])
        return jsonify(
            {
                "book_id": book_id,
                "files_exist_globally": library_service.files_exist_globally(book_id),
                "in_flight_globally": library_service.in_flight_globally(book_id),
                "in_my_library": True,
            }
        )

    @app.route("/api/library/books", methods=["GET"])
    def api_library_list_books() -> Response | LibraryRouteResponse:
        action = "list_books"
        gate = _actor_gate(action)
        if isinstance(gate, _ActorContext):
            actor = gate
        else:
            return gate

        query = request.args.get("q", type=str) or None
        pagination = _parse_pagination_params()
        if pagination is None:
            return _error_response(
                action=action, status_code=400, error="limit must be 1..100 and offset must be >= 0"
            )
        limit, offset = pagination
        availability = request.args.get("availability")
        if availability not in {"with-files", "needs-files"}:
            availability = "all"
        include_all_libraries = actor.is_admin and (
            actor.owner_scope is None or request.args.get("scope") == "all"
        )
        try:
            books, total = library_service.list_library_books(
                user_id=actor.owner_scope,
                is_admin=include_all_libraries,
                query=query,
                availability=availability,
                limit=limit,
                offset=offset,
            )
        except _OPERATIONAL_ERRORS as exc:
            logger.error_trace(
                "Library list_books failed", extra={"action": "list_books", "exc": exc}
            )
            return jsonify({"error": "Internal server error"}), 500

        files_by_book = library_service.get_files_on_disk_for_books(
            [int(row["id"]) for row in books]
        )
        serialized: list[dict[str, Any]] = []
        for row in books:
            book_id = int(row["id"])
            summary = _serialize_book_summary(row, library_added_at=row.get("library_added_at"))
            summary["formats_on_disk"] = files_by_book.get(book_id, [])
            serialized.append(summary)
        return jsonify({"books": serialized, "total": total, "limit": limit, "offset": offset})

    @app.route("/api/library/review/inbox", methods=["GET"])
    def api_library_review_inbox() -> Response | LibraryRouteResponse:
        action = "review_inbox"
        gate = _actor_gate(action)
        if isinstance(gate, _ActorContext):
            actor = gate
        else:
            return gate
        if not actor.is_admin:
            return _error_response(action=action, status_code=403, error="Admin required")
        if import_activity_service is None:
            return jsonify({"items": []})

        try:
            activities = import_activity_service.list_needs_review()
        except (OSError, sqlite3.Error) as exc:
            logger.warning("Inbox review list failed: %s", exc)
            return jsonify({"error": "Internal server error"}), 500

        from shelfmark.core.member_matcher import (
            book_evidence_from_snapshot,
            decide,
            parse_structured_member,
        )

        items: list[dict[str, Any]] = []
        for activity in activities:
            book_snapshot = activity.get("book_snapshot") or {}
            source_release = activity.get("source_release") or {}
            try:
                source_root = normalize_optional_text(source_release.get("source_root"))
                root = Path(source_root) if source_root else None
                members = import_activity_service.source_members(
                    source_release_id=activity["source_release_id"]
                )
            except (OSError, sqlite3.Error) as exc:
                logger.warning(
                    "Inbox review members failed for activity %s: %s", activity.get("id"), exc
                )
                members = []
                root = None
            book_evidence = book_evidence_from_snapshot(book_snapshot)

            evidence_rows: list[dict[str, Any]] = []
            for member in members:
                member_evidence = parse_structured_member(member.get("relative_path") or "")
                decision = decide(book_evidence, member_evidence)
                evidence_rows.append(
                    {
                        "relative_path": member.get("relative_path"),
                        "format": member.get("format"),
                        "available": bool(
                            root and (root / (member.get("relative_path") or "")).is_file()
                        ),
                        "decision_reason": decision.reason,
                        "auto_select": decision.auto_select,
                    }
                )

            items.append(
                {
                    "activity_id": activity["id"],
                    "book_id": normalize_positive_int(book_snapshot.get("id")),
                    "book_title": str(book_snapshot.get("title") or "Unknown title"),
                    "book_author": normalize_optional_text(book_snapshot.get("author")),
                    "source": source_release.get("source"),
                    "source_key": source_release.get("source_key"),
                    "state": activity["state"],
                    "updated_at": activity.get("updated_at"),
                    "evidence": evidence_rows,
                }
            )
        return jsonify({"items": items})

    @app.route("/api/library/books/<int:book_id>", methods=["GET"])
    def api_library_book_detail(book_id: int) -> Response | LibraryRouteResponse:
        action = "book_detail"
        gate = _actor_gate(action)
        if isinstance(gate, _ActorContext):
            actor = gate
        else:
            return gate

        try:
            book = library_service.get_book(book_id)
        except _OPERATIONAL_ERRORS as exc:
            logger.error_trace(
                "Library book_detail failed",
                extra={"action": "book_detail", "book_id": book_id, "exc": exc},
            )
            return jsonify({"error": "Internal server error"}), 500
        if book is None:
            return _error_response(
                action=action, status_code=404, error="Book not found", book_id=book_id
            )

        membership_error = _membership_or_403(actor, book_id, action)
        if membership_error is not None:
            return membership_error

        try:
            files = library_service.get_files_on_disk(book_id)
            in_flight = library_service.get_in_flight_files(book_id)
            derived_epub_by_history_id = {
                int(file["id"]): {"status": _derived_epub_status(derived)}
                for file in files
                if normalize_positive_int(file.get("id")) is not None
                and (
                    derived := library_service.get_derived_epub(
                        book_id=book_id, history_id=int(file["id"])
                    )
                )
                is not None
                and _derived_epub_status(derived) == "ready"
            }
        except _OPERATIONAL_ERRORS as exc:
            logger.error_trace(
                "Library book_detail files lookup failed",
                extra={"action": "book_detail", "book_id": book_id, "exc": exc},
            )
            return jsonify({"error": "Internal server error"}), 500

        downloadable_history_ids = {
            history_id
            for f in files
            if (history_id := normalize_positive_int(f.get("id"))) is not None
        }
        relative_paths_by_output: dict[str, str] = {}
        if import_activity_service is not None:
            activity_ids = [
                int(f["import_activity_id"])
                for f in files
                if normalize_positive_int(f.get("import_activity_id")) is not None
            ]
            if activity_ids:
                try:
                    relative_paths_by_output = (
                        import_activity_service.relative_paths_by_output_path(
                            import_activity_ids=activity_ids
                        )
                    )
                except _OPERATIONAL_ERRORS as exc:
                    logger.warning(
                        "Failed to resolve torrent paths for book_id=%s: %s", book_id, exc
                    )
        detail = _serialize_book_detail(
            book,
            files=files,
            in_flight=in_flight,
            downloadable_history_ids=downloadable_history_ids,
            relative_paths_by_output=relative_paths_by_output,
            derived_epub_by_history_id=derived_epub_by_history_id,
        )
        detail["in_my_library"] = library_service.is_in_library(
            user_id=actor.db_user_id, book_id=book_id
        )
        if actor.is_admin:
            from shelfmark.download.postprocess.scan import get_supported_formats

            configured = app_config.get("SUPPORTED_FORMATS", get_supported_formats())
            enabled_formats = (
                sorted({str(value).strip().lower() for value in configured if str(value).strip()})
                if isinstance(configured, list)
                else get_supported_formats()
            )
            try:
                max_total_bytes = max(
                    1, int(str(app_config.get("MANUAL_UPLOAD_MAX_TOTAL_BYTES", 1024 * 1024 * 1024)))
                )
                max_file_count = max(1, int(str(app_config.get("MANUAL_UPLOAD_MAX_FILE_COUNT", 50))))
            except (TypeError, ValueError):
                max_total_bytes, max_file_count = 1024 * 1024 * 1024, 50
            detail["manual_upload"] = {
                "enabled_formats": enabled_formats,
                "max_total_bytes": max_total_bytes,
                "max_file_count": max_file_count,
            }
        return jsonify(detail)

    @app.route("/api/library/books/<int:book_id>", methods=["DELETE"])
    def api_library_remove_book(book_id: int) -> Response | LibraryRouteResponse:
        action = "remove_book"
        gate = _actor_gate(action)
        if isinstance(gate, _ActorContext):
            actor = gate
        else:
            return gate

        # Admin scoped to own library (sub-decision 2).
        if not library_service.is_in_library(user_id=actor.db_user_id, book_id=book_id):
            return _error_response(
                action=action, status_code=404, error="Book not found", book_id=book_id
            )
        try:
            library_service.remove_from_library(user_id=actor.db_user_id, book_id=book_id)
        except _OPERATIONAL_ERRORS as exc:
            logger.error_trace(
                "Library remove_book failed",
                extra={"action": "remove_book", "book_id": book_id, "exc": exc},
            )
            return jsonify({"error": "Internal server error"}), 500
        return jsonify({"status": "removed"})

    @app.route("/api/library/books/<int:book_id>/purge-preview", methods=["GET"])
    def api_library_book_purge_preview(book_id: int) -> Response | LibraryRouteResponse:
        action = "purge_preview"
        gate = _actor_gate(action)
        if not isinstance(gate, _ActorContext):
            return gate
        admin_error = _admin_or_403(gate, action=action, book_id=book_id)
        if admin_error is not None:
            return admin_error
        try:
            if library_service.get_book(book_id) is None:
                return _error_response(
                    action=action, status_code=404, error="Book not found", book_id=book_id
                )
            return jsonify({"users": library_service.get_book_members(book_id)})
        except _OPERATIONAL_ERRORS as exc:
            logger.error_trace(
                "Library purge_preview failed",
                extra={"action": "purge_preview", "book_id": book_id, "exc": exc},
            )
            return jsonify({"error": "Internal server error"}), 500

    @app.route("/api/library/books/<int:book_id>/purge", methods=["DELETE"])
    def api_library_purge_book(book_id: int) -> Response | LibraryRouteResponse:
        action = "purge_book"
        gate = _actor_gate(action)
        if not isinstance(gate, _ActorContext):
            return gate
        admin_error = _admin_or_403(gate, action=action, book_id=book_id)
        if admin_error is not None:
            return admin_error
        try:
            removed = library_service.purge_book(
                book_id=book_id,
                cancel_download=cancel_download,
            )
        except _OPERATIONAL_ERRORS as exc:
            logger.warning("Library purge_book cleanup failed for book_id=%s: %s", book_id, exc)
            return jsonify({"error": "Failed to purge book"}), 500
        if not removed:
            return _error_response(
                action=action, status_code=404, error="Book not found", book_id=book_id
            )
        return jsonify({"status": "purged"})

    @app.route("/api/library/books/<int:book_id>/download", methods=["GET"])
    def api_library_download_file(book_id: int) -> Response | LibraryRouteResponse:
        action = "download_file"
        gate = _actor_gate(action)
        if isinstance(gate, _ActorContext):
            actor = gate
        else:
            return gate

        membership_error = _membership_or_403(actor, book_id, action)
        if membership_error is not None:
            return membership_error

        fmt = normalize_optional_text(request.args.get("format"))
        history_id = normalize_positive_int(request.args.get("history_id"))
        try:
            files = library_service.get_files_on_disk(book_id)
            book = library_service.get_book(book_id)
        except _OPERATIONAL_ERRORS as exc:
            logger.error_trace(
                "Library download_file lookup failed",
                extra={"action": "download_file", "book_id": book_id, "exc": exc},
            )
            return jsonify({"error": "Internal server error"}), 500

        def _matches(row: dict[str, Any]) -> bool:
            if history_id is not None and normalize_positive_int(row.get("id")) != history_id:
                return False
            if fmt is None:
                return True
            row_format = normalize_optional_text(row.get("format"))
            return row_format is not None and row_format.lower() == fmt.lower()

        matching = [f for f in files if _matches(f)]
        if not matching:
            return _error_response(
                action=action,
                status_code=404,
                error="No compatible file found",
                book_id=book_id,
            )

        target = matching[0]
        download_path = normalize_optional_text(target.get("download_path"))
        if not download_path or not Path(download_path).exists():
            return _error_response(
                action=action,
                status_code=404,
                error="File not found on disk",
                book_id=book_id,
            )
        return send_file(
            download_path,
            download_name=(
                Path(download_path).name
                if target.get("source") == "manual"
                else _book_attachment_name(
                    book=book,
                    book_id=book_id,
                    download_path=download_path,
                )
            ),
            as_attachment=True,
        )

    @app.route(
        "/api/library/books/<int:book_id>/downloads/<int:history_id>/converted-epub",
        methods=["GET"],
    )
    def api_library_download_converted_epub(
        book_id: int, history_id: int
    ) -> Response | LibraryRouteResponse:
        action = "download_converted_epub"
        gate = _actor_gate(action)
        if not isinstance(gate, _ActorContext):
            return gate
        membership_error = _membership_or_403(gate, book_id, action)
        if membership_error is not None:
            return membership_error
        try:
            artifact = library_service.get_derived_epub(book_id=book_id, history_id=history_id)
            book = library_service.get_book(book_id)
        except _OPERATIONAL_ERRORS as exc:
            logger.error_trace(
                "Library download_converted_epub lookup failed",
                extra={"action": action, "book_id": book_id, "history_id": history_id, "exc": exc},
            )
            return jsonify({"error": "Internal server error"}), 500
        if artifact is None:
            return _error_response(
                action=action, status_code=404, error="Converted EPUB unavailable", book_id=book_id
            )
        if artifact["status"] in {"pending", "converting", "interrupted"}:
            return _error_response(
                action=action,
                status_code=409,
                error="Converted EPUB unavailable",
                book_id=book_id,
            )
        path = normalize_optional_text(artifact.get("artifact_path"))
        if (
            artifact["status"] != "ready"
            or artifact.get("validation_result") != "valid"
            or not path
        ):
            return _error_response(
                action=action, status_code=409, error="Converted EPUB unavailable", book_id=book_id
            )
        artifact_path = Path(path)
        if not artifact_path.is_file():
            return _error_response(
                action=action, status_code=404, error="Converted EPUB unavailable", book_id=book_id
            )
        return send_file(
            artifact_path,
            download_name=_book_attachment_name(
                book=book, book_id=book_id, download_path=str(artifact_path)
            ),
            as_attachment=True,
        )

    @app.route(
        "/api/library/books/<int:book_id>/downloads/<int:history_id>/converted-epub",
        methods=["POST"],
    )
    def api_library_retry_converted_epub(
        book_id: int, history_id: int
    ) -> Response | LibraryRouteResponse:
        action = "retry_converted_epub"
        gate = _actor_gate(action)
        if not isinstance(gate, _ActorContext):
            return gate
        membership_error = _membership_or_403(gate, book_id, action)
        if membership_error is not None:
            return membership_error
        try:
            retried = library_service.retry_derived_epub(book_id=book_id, history_id=history_id)
        except _OPERATIONAL_ERRORS as exc:
            logger.error_trace(
                "Library retry_converted_epub failed",
                extra={"action": action, "book_id": book_id, "history_id": history_id, "exc": exc},
            )
            return jsonify({"error": "Internal server error"}), 500
        if not retried:
            return _error_response(
                action=action,
                status_code=409,
                error="Converted EPUB unavailable",
                book_id=book_id,
            )
        return jsonify({"status": "converting"}), 202

    @app.route("/api/library/books/<int:book_id>/send-to-kindle", methods=["POST"])
    def api_library_send_to_kindle(book_id: int) -> Response | LibraryRouteResponse:
        action = "send_to_kindle"
        gate = _actor_gate(action)
        if isinstance(gate, _ActorContext):
            actor = gate
        else:
            return gate

        membership_error = _membership_or_403(actor, book_id, action)
        if membership_error is not None:
            return membership_error

        # Fail-fast ordering per #04 sub-decision 16.
        data = request.get_json(silent=True) or {}
        requested_format = (
            normalize_optional_text(data.get("format")) if isinstance(data, dict) else None
        )
        requested_history_id = (
            normalize_positive_int(data.get("history_id")) if isinstance(data, dict) else None
        )
        if isinstance(data, dict) and "history_id" in data and requested_history_id is None:
            return _error_response(
                action=action,
                status_code=400,
                error="history_id must be a positive integer",
                book_id=book_id,
            )

        try:
            resolved = (
                library_service.resolve_kindle_history_id(
                    book_id=book_id, history_id=requested_history_id
                )
                if requested_history_id is not None
                else library_service.resolve_kindle_format(
                    book_id=book_id,
                    requested_format=requested_format,
                    user_id=None,
                )
            )
            book = library_service.get_book(book_id)
        except _OPERATIONAL_ERRORS as exc:
            logger.error_trace(
                "Library send_to_kindle resolve failed",
                extra={"action": "send_to_kindle", "book_id": book_id, "exc": exc},
            )
            return jsonify({"error": "Internal server error"}), 500
        if resolved is None:
            return _error_response(
                action=action,
                status_code=404,
                error="No compatible file found",
                book_id=book_id,
            )
        conversion_status = normalize_optional_text(resolved.get("conversion_status"))
        if conversion_status is not None:
            return _error_response(
                action=action,
                status_code=409,
                error="Converted EPUB unavailable",
                book_id=book_id,
            )

        recipient = normalize_optional_text(
            user_db.get_personal_preferences(actor.db_user_id).get("kindle_address")
        )
        if not recipient:
            return _error_response(
                action=action,
                status_code=400,
                error="No email recipient configured",
                book_id=book_id,
            )

        download_path = normalize_optional_text(resolved.get("download_path"))
        if not download_path or not Path(download_path).exists():
            return _error_response(
                action=action,
                status_code=404,
                error="File not found on disk",
                book_id=book_id,
            )

        attachment_name = _book_attachment_name(
            book=book, book_id=book_id, download_path=download_path
        )

        from shelfmark.download.outputs.email import (
            EmailOutputError,
            send_file_to_email,
        )

        try:
            masked_recipient = send_file_to_email(
                Path(download_path),
                recipient,
                label=recipient,
                subject=attachment_name,
                attachment_name=attachment_name,
            )
        except EmailOutputError as exc:
            logger.error_trace(
                "Send-to-Kindle SMTP failure",
                extra={"action": "send_to_kindle", "book_id": book_id, "exc": exc},
            )
            return jsonify({"error": "Internal server error"}), 500
        except _OPERATIONAL_ERRORS as exc:
            logger.error_trace(
                "Send-to-Kindle unexpected error",
                extra={"action": "send_to_kindle", "book_id": book_id, "exc": exc},
            )
            return jsonify({"error": "Internal server error"}), 500

        return jsonify(
            {
                "status": "sent",
                "recipient": masked_recipient,
                "format": resolved.get("format"),
            }
        )

    @app.route("/api/library/books/<int:book_id>/downloads/<int:history_id>", methods=["POST"])
    def api_library_link_download(book_id: int, history_id: int) -> Response | LibraryRouteResponse:
        action = "link_download"
        gate = _actor_gate(action)
        if isinstance(gate, _ActorContext):
            actor = gate
        else:
            return gate

        membership_error = _membership_or_403(actor, book_id, action)
        if membership_error is not None:
            return membership_error

        try:
            row = library_service.get_download_history_row(history_id)
        except _OPERATIONAL_ERRORS as exc:
            logger.error_trace(
                "Library link_download history row lookup failed",
                extra={"action": "link_download", "history_id": history_id, "exc": exc},
            )
            return jsonify({"error": "Internal server error"}), 500
        if row is None or normalize_positive_int(row.get("book_id")) != book_id:
            return _error_response(
                action=action,
                status_code=404,
                error="Download not found for this book",
                book_id=book_id,
            )
        try:
            library_service.link_download_to_user(
                user_id=actor.db_user_id,
                book_id=book_id,
                history_id=history_id,
            )
        except _OPERATIONAL_ERRORS as exc:
            logger.error_trace(
                "Library link_download link failed",
                extra={
                    "action": "link_download",
                    "book_id": book_id,
                    "history_id": history_id,
                    "exc": exc,
                },
            )
            return jsonify({"error": "Internal server error"}), 500
        return jsonify({"status": "linked"})

    @app.route(
        "/api/library/books/<int:book_id>/releases/<int:activity_id>/review", methods=["GET"]
    )
    def api_library_release_review(
        book_id: int, activity_id: int
    ) -> Response | LibraryRouteResponse:
        action = "release_review"
        gate = _actor_gate(action)
        if not isinstance(gate, _ActorContext):
            return gate
        admin_error = _admin_or_403(gate, action=action, book_id=book_id)
        if admin_error is not None:
            return admin_error
        if import_activity_service is None:
            return _error_response(action=action, status_code=404, error="Source release not found")
        try:
            activity = import_activity_service.get_book_activity(
                activity_id=activity_id, book_id=book_id
            )
        except _OPERATIONAL_ERRORS as exc:
            logger.error_trace(
                "Library release_review activity lookup failed",
                extra={
                    "action": "release_review",
                    "book_id": book_id,
                    "activity_id": activity_id,
                    "exc": exc,
                },
            )
            return jsonify({"error": "Internal server error"}), 500
        if activity is None or activity["state"] not in {"completed", "needs review"}:
            return _error_response(action=action, status_code=404, error="Source release not found")
        if activity["source_release"]["source"] == "manual":
            return _error_response(action=action, status_code=404, error="Source release not found")
        source_root = normalize_optional_text(activity["source_release"].get("source_root"))
        if source_root is None:
            return _error_response(
                action=action, status_code=409, error="Retained source is unavailable"
            )

        from shelfmark.download.postprocess.scan import get_supported_formats

        supported_formats = set(get_supported_formats())
        root = Path(source_root)
        selection_evidence = {
            selection["source_member_id"]: selection["evidence"]
            for selection in activity["selections"]
        }
        members = [
            {
                "id": member["id"],
                "relative_path": member["relative_path"],
                "format": member["format"],
                "size": member["size"],
                "available": (root / member["relative_path"]).is_file(),
                "evidence": selection_evidence.get(member["id"], {}),
                "evidence_summary": "Previously selected"
                if member["id"] in selection_evidence
                else "No prior selection evidence",
            }
            for member in import_activity_service.source_members(
                source_release_id=activity["source_release_id"]
            )
            if member["format"] in supported_formats
        ]
        return jsonify(
            {
                "activity_id": activity["id"],
                "source": activity["source_release"]["source"],
                "source_key": activity["source_release"]["source_key"],
                "members": members,
                "destination": str(storage_root or Path("/books")),
            }
        )

    @app.route(
        "/api/library/books/<int:book_id>/releases/<int:activity_id>/review", methods=["POST"]
    )
    def api_library_replace_release(
        book_id: int, activity_id: int
    ) -> Response | LibraryRouteResponse:
        action = "replace_release"
        gate = _actor_gate(action)
        if not isinstance(gate, _ActorContext):
            return gate
        admin_error = _admin_or_403(gate, action=action, book_id=book_id)
        if admin_error is not None:
            return admin_error
        if import_activity_service is None or storage_root is None:
            return _error_response(action=action, status_code=404, error="Source release not found")
        data = request.get_json(silent=True)
        member_ids = data.get("member_ids") if isinstance(data, dict) else None
        if (
            not isinstance(member_ids, list)
            or not member_ids
            or any(not isinstance(member_id, int) or member_id < 1 for member_id in member_ids)
            or len(set(member_ids)) != len(member_ids)
        ):
            return _error_response(
                action=action,
                status_code=400,
                error="Select one or more source files",
                book_id=book_id,
            )
        try:
            original = import_activity_service.get_book_activity(
                activity_id=activity_id, book_id=book_id
            )
            if original is None or original["state"] not in {"completed", "needs review"}:
                return _error_response(
                    action=action, status_code=404, error="Source release not found"
                )
            if original["source_release"]["source"] == "manual":
                return _error_response(action=action, status_code=404, error="Source release not found")
            source_root = normalize_optional_text(original["source_release"].get("source_root"))
            if source_root is None:
                return _error_response(
                    action=action,
                    status_code=409,
                    error="Retained source is unavailable",
                    book_id=book_id,
                )
            root = Path(source_root)
            members = {
                member["id"]: member
                for member in import_activity_service.source_members(
                    source_release_id=original["source_release_id"]
                )
            }
            selected = [members.get(member_id) for member_id in member_ids]
            if any(member is None for member in selected):
                return _error_response(
                    action=action, status_code=400, error="Unknown source member"
                )
            selected_members = [member for member in selected if member is not None]
            if any(not (root / member["relative_path"]).is_file() for member in selected_members):
                return _error_response(
                    action=action,
                    status_code=409,
                    error="One or more selected source files are unavailable",
                    book_id=book_id,
                )
            correction = import_activity_service.create_manual_correction(
                source_release_id=original["source_release_id"],
                book_id=book_id,
                task_id=f"manual-{uuid.uuid4()}",
                selected_by_user_id=gate.db_user_id,
            )
            correction = import_activity_service.plan_import(
                activity_id=correction["id"],
                storage_root=storage_root,
                selections=[
                    {"source_member_id": member["id"], "evidence": {"match": "manual"}}
                    for member in selected_members
                ],
                allow_existing_book_members=True,
            )
            from shelfmark.download.postprocess.transfer import transfer_selected_source_members

            paths, error, _ = transfer_selected_source_members(
                [
                    (root / member["relative_path"], Path(selection["planned_output_path"]))
                    for member, selection in zip(
                        selected_members, correction["selections"], strict=True
                    )
                ],
                use_hardlink=hardlink_torrents,
            )
            if error:
                raise RuntimeError(error)
            download_history_service.record_download(
                task_id=correction["task_id"],
                user_id=gate.db_user_id,
                username=None,
                request_id=None,
                source=original["source_release"]["source"],
                source_display_name=original["source_release"]["source"],
                title=str(original["book_snapshot"].get("title") or "Unknown title"),
                author=normalize_optional_text(original["book_snapshot"].get("author")),
                file_format=None,
                size=None,
                preview=None,
                content_type="ebook",
                origin="book",
                book_id=book_id,
                import_activity_id=correction["id"],
            )
            download_history_service.finalize_download_files(
                task_id=correction["task_id"],
                final_status="complete",
                file_rows=[
                    {
                        "download_path": str(path),
                        "format": member["format"],
                        "size": str(member["size"]) if member["size"] is not None else None,
                    }
                    for member, path in zip(selected_members, paths, strict=True)
                ],
            )
            if original["state"] == "completed":
                old_files = library_service.get_files_on_disk(book_id)
                old_file = next(
                    (
                        file
                        for file in old_files
                        if file.get("import_activity_id") == original["id"]
                    ),
                    None,
                )
                if old_file is None or not library_service.delete_release(
                    book_id=book_id, history_id=int(old_file["id"])
                ):
                    msg = "Completed release could not be replaced"
                    raise RuntimeError(msg)
            import_activity_service.complete(activity_id=correction["id"])
            if original["state"] == "needs review":
                # The review import gives the Book at least one file and supersedes
                # the pending casework activity: remove it from the Inbox while
                # retaining its release-history audit.
                import_activity_service.complete(activity_id=original["id"])
        except _OPERATIONAL_ERRORS as exc:
            logger.error_trace(
                "Library release replacement failed",
                extra={"action": "replace_release", "book_id": book_id, "exc": exc},
            )
            return jsonify({"error": "Internal server error"}), 500
        return jsonify({"status": "completed", "activity_id": correction["id"]})

    @app.route(
        "/api/library/books/<int:book_id>/releases/<int:activity_id>/review", methods=["DELETE"]
    )
    def api_library_cancel_review(
        book_id: int, activity_id: int
    ) -> Response | LibraryRouteResponse:
        action = "cancel_review"
        gate = _actor_gate(action)
        if not isinstance(gate, _ActorContext):
            return gate
        admin_error = _admin_or_403(gate, action=action, book_id=book_id)
        if admin_error is not None:
            return admin_error
        if import_activity_service is None:
            return _error_response(action=action, status_code=404, error="Source release not found")
        try:
            activity = import_activity_service.get_book_activity(
                activity_id=activity_id, book_id=book_id
            )
        except _OPERATIONAL_ERRORS as exc:
            logger.warning("Library review activity lookup failed: %s", exc)
            return jsonify({"error": "Internal server error"}), 500
        if activity is None or activity["state"] != "needs review":
            return _error_response(action=action, status_code=404, error="Source release not found")
        try:
            # "No relevant files" — cancel the pending review, removing it from the
            # Inbox while retaining its release-history audit.
            import_activity_service.cancel(activity_id=activity_id)
        except _OPERATIONAL_ERRORS as exc:
            logger.warning("Library review cancel failed: %s", exc)
            return jsonify({"error": "Internal server error"}), 500
        return jsonify({"status": "cancelled", "activity_id": activity_id})

    @app.route("/api/library/books/<int:book_id>/downloads/<int:history_id>", methods=["DELETE"])
    def api_library_delete_release(
        book_id: int, history_id: int
    ) -> Response | LibraryRouteResponse:
        action = "delete_release"
        gate = _actor_gate(action)
        if isinstance(gate, _ActorContext):
            actor = gate
        else:
            return gate

        if not actor.is_admin:
            return _error_response(
                action=action,
                status_code=403,
                error="Deleting releases is only allowed for administrators",
                book_id=book_id,
            )
        try:
            row = library_service.get_download_history_row(history_id)
        except _OPERATIONAL_ERRORS as exc:
            logger.error_trace(
                "Library delete_release history row lookup failed",
                extra={"action": "delete_release", "history_id": history_id, "exc": exc},
            )
            return jsonify({"error": "Internal server error"}), 500
        if row is None or normalize_positive_int(row.get("book_id")) != book_id:
            return _error_response(
                action=action,
                status_code=404,
                error="Download not found for this book",
                book_id=book_id,
            )
        if row.get("final_status") != "complete" or not normalize_optional_text(
            row.get("download_path")
        ):
            return _error_response(
                action=action,
                status_code=409,
                error="Only completed releases can be deleted",
                book_id=book_id,
            )

        try:
            deleted = library_service.delete_release(book_id=book_id, history_id=history_id)
        except _OPERATIONAL_ERRORS as exc:
            logger.error_trace(
                "Library delete_release failed",
                extra={
                    "action": "delete_release",
                    "book_id": book_id,
                    "history_id": history_id,
                    "exc": exc,
                },
            )
            return jsonify({"error": "Internal server error"}), 500
        if not deleted:
            return _error_response(
                action=action,
                status_code=409,
                error="Only completed releases can be deleted",
                book_id=book_id,
            )
        clear_completed_download(str(row["task_id"]))
        return jsonify({"status": "deleted"})
