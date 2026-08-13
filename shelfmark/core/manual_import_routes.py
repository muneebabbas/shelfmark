"""Administrator-only HTTP endpoints for manual Book imports."""

from __future__ import annotations

from typing import TYPE_CHECKING

from flask import Flask, Response, jsonify, request, session

from shelfmark.core.manual_import_service import ManualImportError, ManualImportService
from shelfmark.core.request_helpers import get_session_db_user_id

if TYPE_CHECKING:
    from collections.abc import Callable

    from shelfmark.core.library_service import LibraryService


def register_manual_import_routes(
    app: Flask,
    *,
    service: ManualImportService,
    library_service: LibraryService,
    resolve_auth_mode: Callable[[], str],
) -> None:
    """Register the narrow upload/status surface; all routes require admin scope."""

    def actor_id() -> int | None:
        if resolve_auth_mode() == "none":
            return 0
        if not bool(session.get("is_admin")):
            return None
        value = get_session_db_user_id(session)
        return int(value) if value is not None else None

    @app.post("/api/library/books/<int:book_id>/manual-upload")
    def api_manual_upload(book_id: int) -> Response | tuple[Response, int]:
        actor = actor_id()
        if actor is None:
            return jsonify({"error": "Admin required"}), 403
        if library_service.get_book(book_id) is None:
            return jsonify({"error": "Book not found"}), 404
        try:
            accepted = service.accept(
                book_id=book_id,
                actor_id=actor,
                actor_username=session.get("user_id"),
                files=request.files.getlist("files"),
            )
        except ManualImportError as exc:
            return jsonify({"error": exc.public_message}), 400
        except OSError, RuntimeError, TypeError, ValueError:
            return jsonify({"error": "Internal server error"}), 500
        return jsonify(accepted), 202

    @app.get("/api/library/manual-uploads/<int:activity_id>")
    def api_manual_upload_status(activity_id: int) -> Response | tuple[Response, int]:
        actor = actor_id()
        if actor is None:
            return jsonify({"error": "Admin required"}), 403
        try:
            status = service.status(activity_id=activity_id, actor_id=actor)
        except OSError, RuntimeError, TypeError, ValueError:
            return jsonify({"error": "Internal server error"}), 500
        if status is None:
            return jsonify({"error": "Manual import not found"}), 404
        return jsonify(status)
