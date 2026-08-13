"""Manual administrator Book ingestion tests."""

from __future__ import annotations

from io import BytesIO

import pytest
from werkzeug.datastructures import FileStorage

from shelfmark.core.download_history_service import DownloadHistoryService
from shelfmark.core.import_activity_service import ImportActivityService
from shelfmark.core.library_service import LibraryService
from shelfmark.core.manual_import_service import ManualImportError, ManualImportService
from shelfmark.core.user_db import UserDB


@pytest.fixture
def services(tmp_path):
    db_path = str(tmp_path / "users.db")
    users = UserDB(db_path)
    users.initialize()
    admin = users.create_user(username="admin")
    conn = users._connect()
    try:
        cursor = conn.execute(
            "INSERT INTO books (metadata_provider, provider_book_id, title, author, metadata_json) VALUES (?, ?, ?, ?, '{}')",
            ("hardcover", "manual", "Manual Book", "Author"),
        )
        conn.commit()
        book_id = int(cursor.lastrowid)
    finally:
        conn.close()
    started: list[object] = []
    service = ManualImportService(
        imports=ImportActivityService(db_path),
        history=DownloadHistoryService(db_path),
        library=LibraryService(db_path),
        storage_root=tmp_path / "library",
        tmp_root=tmp_path / "tmp",
        enabled_formats=lambda: {"epub", "pdf"},
        limits=lambda: (100, 2),
        start_background=lambda fn, *args: started.append((fn, args)),
        ws_manager=None,
        emit_availability=lambda book_id, task_id: None,
    )
    return service, users, admin, book_id, started


def _upload(name: str, content: bytes) -> FileStorage:
    return FileStorage(stream=BytesIO(content), filename=name)


def test_manual_import_accepts_and_finalizes_one_multi_file_release(services):
    service, users, admin, book_id, started = services
    accepted = service.accept(
        book_id=book_id,
        actor_id=admin["id"],
        actor_username="admin",
        files=[_upload("One.epub", b"one"), _upload("Two.pdf", b"two")],
    )

    assert accepted["state"] == "importing"
    assert accepted["file_count"] == 2
    fn, args = started.pop()
    fn(*args)

    status = service.status(activity_id=accepted["activity_id"], actor_id=admin["id"])
    assert status is not None and status["state"] == "completed"
    files = LibraryService(users._db_path).get_files_on_disk(book_id)
    assert {file["download_path"].split("/")[-1] for file in files} == {"One.epub", "Two.pdf"}
    activity = ImportActivityService(users._db_path).get_by_id(accepted["activity_id"])
    assert activity is not None
    assert activity["source_release"]["source"] == "manual"
    assert activity["source_release"]["source_root"] is None
    assert activity["selected_by_user_id"] == admin["id"]


@pytest.mark.parametrize(
    ("files", "message"),
    [
        ([_upload("bad.exe", b"x")], "unsupported"),
        ([_upload("same.epub", b"x"), _upload("SAME.epub", b"y")], "unique"),
        ([_upload("one.epub", b"x"), _upload("two.pdf", b"y"), _upload("three.pdf", b"z")], "many"),
        ([_upload("large.epub", b"x" * 101)], "size"),
    ],
)
def test_manual_import_rejects_whole_invalid_submission(services, files, message):
    service, users, admin, book_id, started = services
    with pytest.raises(ManualImportError, match=message):
        service.accept(book_id=book_id, actor_id=admin["id"], actor_username="admin", files=files)
    assert started == []
    assert ImportActivityService(users._db_path).list_needs_review() == []


def test_manual_import_failure_removes_partial_output_and_marks_audit_failed(services, monkeypatch):
    service, users, admin, book_id, started = services
    accepted = service.accept(
        book_id=book_id,
        actor_id=admin["id"],
        actor_username="admin",
        files=[_upload("One.epub", b"one")],
    )
    monkeypatch.setattr(
        "shelfmark.core.manual_import_service.transfer_selected_source_members",
        lambda *args, **kwargs: ([], "transfer failed", {}),
    )
    fn, args = started.pop()
    fn(*args)
    assert (
        service.status(activity_id=accepted["activity_id"], actor_id=admin["id"])["state"]
        == "failed"
    )
    assert LibraryService(users._db_path).get_files_on_disk(book_id) == []


def test_manual_import_fulfils_pending_requests_and_links_every_uploaded_file(services):
    service, users, admin, book_id, started = services
    requester = users.create_user(username="requester", library_capability="request-only")
    library = LibraryService(users._db_path)
    library.add_to_library(user_id=requester["id"], book_id=book_id)
    users.create_library_request(user_id=requester["id"], book_id=book_id)

    service.accept(
        book_id=book_id,
        actor_id=admin["id"],
        actor_username="admin",
        files=[_upload("One.epub", b"one"), _upload("Two.pdf", b"two")],
    )
    fn, args = started.pop()
    fn(*args)

    assert users.list_requests(user_id=requester["id"])[0]["status"] == "fulfilled"
    assert len(library.get_files_on_disk(book_id)) == 2
