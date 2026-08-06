"""End-to-end tests for the needs-review routing inside the import transfer path.

These exercise ``_transfer_default_import_selection`` against a real
``ImportActivityService`` (temp DB) with real retained source files, mocking only
the matcher and supported-formats boundaries. They pin the two behaviors the
pure ``_should_route_to_needs_review`` tests cannot reach: that routing is
applied after both the single-variant and auto-selection branches, and that a
non-single release whose epub is missing while another format lands is routed.
"""

from __future__ import annotations

import os
import tempfile
from types import SimpleNamespace
from unittest.mock import patch

import pytest

import shelfmark.main as main_module
from shelfmark.core.import_activity_service import ImportActivityService
from shelfmark.core.user_db import UserDB


@pytest.fixture
def import_activity_service():
    with tempfile.TemporaryDirectory() as tmpdir:
        db_path = os.path.join(tmpdir, "db.sqlite")
        UserDB(db_path).initialize()
        yield ImportActivityService(db_path)


def _make_book(service: ImportActivityService) -> int:
    conn = service._connect()
    try:
        cursor = conn.execute(
            "INSERT INTO books (metadata_provider, provider_book_id, title, author) "
            "VALUES ('openlibrary', 'OLTEST', 'Test Book', 'Test Author')"
        )
        conn.commit()
        return int(cursor.lastrowid)
    finally:
        conn.close()


def _make_task(*, task_id: str, activity_id: int, source_root) -> SimpleNamespace:
    return SimpleNamespace(
        task_id=task_id,
        import_activity_id=activity_id,
        original_download_path=str(source_root),
        download_path=str(source_root),
        content_type=None,
        library_paths=[],
        download_path_set=None,
    )


def _seed_release(service: ImportActivityService, *, book_id: int, task_id: str, root):
    """Create a matching activity with an epub and a mobi retained member on disk."""
    activity = service.accept_book_targeted_release(
        source_key=f"prowlarr:{task_id}",
        source="prowlarr",
        source_metadata={},
        task_id=task_id,
        book_id=book_id,
    )
    service.set_source_root(source_release_id=activity["source_release_id"], source_root=root)
    members = {}
    for name, fmt in (("Book.epub", "epub"), ("Book.mobi", "mobi")):
        path = root / name
        path.write_bytes(b"content")
        members[fmt] = service.record_source_member(
            source_release_id=activity["source_release_id"],
            relative_path=name,
            size=len(b"content"),
            file_format=fmt,
            discovery_status="discovered",
        )
    return activity, members


def test_transfer_routes_when_review_format_missing_while_other_imported(
    import_activity_service, tmp_path, monkeypatch
):
    book_id = _make_book(import_activity_service)
    root = tmp_path / "retained"
    root.mkdir()
    task_id = "mixed-task"
    activity, members = _seed_release(
        import_activity_service, book_id=book_id, task_id=task_id, root=root
    )
    monkeypatch.setattr(main_module, "import_activity_service", import_activity_service)
    monkeypatch.setattr(
        main_module.app_config,
        "get",
        lambda key, default=None: {
            "IMPORT_NEEDS_REVIEW_FORMATS": ["epub"],
            "DESTINATION": str(tmp_path / "dest"),
        }.get(key, default),
    )
    # All members retained as supported.
    with (
        patch(
            "shelfmark.download.postprocess.scan.get_supported_formats",
            return_value=["epub", "mobi"],
        ),
        patch("shelfmark.core.member_matcher.is_single_variant_release", return_value=False),
        # Only the mobi auto-matches; the epub is skipped by the matcher.
        patch(
            "shelfmark.core.member_matcher.auto_selections",
            return_value=[{"source_member_id": members["mobi"]["id"], "evidence": {}}],
        ),
    ):
        main_module._transfer_default_import_selection(
            _make_task(task_id=task_id, activity_id=activity["id"], source_root=root)
        )

    refreshed = import_activity_service.get_by_task_id(task_id)
    assert refreshed["state"] == "needs review"


def test_transfer_does_not_route_when_review_format_imported(
    import_activity_service, tmp_path, monkeypatch
):
    book_id = _make_book(import_activity_service)
    root = tmp_path / "retained"
    root.mkdir()
    task_id = "both-task"
    activity, _ = _seed_release(
        import_activity_service, book_id=book_id, task_id=task_id, root=root
    )
    monkeypatch.setattr(main_module, "import_activity_service", import_activity_service)
    monkeypatch.setattr(
        main_module.app_config,
        "get",
        lambda key, default=None: {
            "IMPORT_NEEDS_REVIEW_FORMATS": ["epub"],
            "DESTINATION": str(tmp_path / "dest"),
        }.get(key, default),
    )
    # Single-variant release: whole release selected (epub included) -> no route.
    with (
        patch(
            "shelfmark.download.postprocess.scan.get_supported_formats",
            return_value=["epub", "mobi"],
        ),
        patch("shelfmark.core.member_matcher.is_single_variant_release", return_value=True),
    ):
        main_module._transfer_default_import_selection(
            _make_task(task_id=task_id, activity_id=activity["id"], source_root=root)
        )

    refreshed = import_activity_service.get_by_task_id(task_id)
    assert refreshed["state"] != "needs review"
    assert refreshed["selections"]
