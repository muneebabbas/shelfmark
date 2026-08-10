"""Tests for internal AZW3-derived EPUB artifacts."""

import sqlite3
import zipfile

from shelfmark.core.derived_artifact_service import DerivedArtifactService
from shelfmark.core.user_db import UserDB


def test_initialize_creates_derived_artifact_schema(tmp_path):
    db_path = tmp_path / "users.db"
    UserDB(str(db_path)).initialize()

    conn = sqlite3.connect(db_path)
    try:
        columns = {row[1] for row in conn.execute("PRAGMA table_info(derived_artifacts)")}
        indexes = {row[1] for row in conn.execute("PRAGMA index_list(derived_artifacts)")}
    finally:
        conn.close()

    assert {
        "source_history_id",
        "book_id",
        "source_hash",
        "target_format",
        "converter_version",
        "normalized_options",
        "artifact_path",
        "output_size",
        "output_hash",
        "status",
        "validation_result",
        "error_code",
        "cleanup_error",
        "created_at",
        "updated_at",
        "started_at",
        "completed_at",
    } <= columns
    assert "idx_derived_artifacts_identity" in indexes


def test_conversion_creates_one_private_ready_artifact_and_reuses_it(tmp_path, monkeypatch):
    db_path = tmp_path / "users.db"
    user_db = UserDB(str(db_path))
    user_db.initialize()
    source = tmp_path / "Example.azw3"
    source.write_bytes(b"azw3 source")
    conn = user_db._connect()
    try:
        book_id = conn.execute(
            "INSERT INTO books (metadata_provider, provider_book_id, title) VALUES (?, ?, ?)",
            ("test", "example", "Example"),
        ).lastrowid
        history_id = conn.execute(
            """INSERT INTO download_history (task_id, source, title, format, final_status,
            download_path, book_id) VALUES (?, ?, ?, ?, ?, ?, ?)""",
            ("example", "test", "Example", "azw3", "complete", str(source), book_id),
        ).lastrowid
        conn.commit()
    finally:
        conn.close()

    converted_commands = []

    def fake_convert(command, **_kwargs):
        converted_commands.append(command)
        output = command[2]
        with zipfile.ZipFile(output, "w") as archive:
            archive.writestr(
                "META-INF/container.xml",
                '<container><rootfiles><rootfile full-path="EPUB/package.opf"/></rootfiles></container>',
            )
            archive.writestr(
                "EPUB/package.opf",
                '<package><manifest><item id="nav" href="nav.xhtml" properties="nav"/>'
                '<item id="chapter" href="chapter.xhtml"/></manifest>'
                '<spine><itemref idref="chapter"/></spine></package>',
            )
            archive.writestr("EPUB/chapter.xhtml", "<html/>")
            archive.writestr("EPUB/nav.xhtml", "<html/>")

    monkeypatch.setattr("shelfmark.core.derived_artifact_service.subprocess.run", fake_convert)
    service = DerivedArtifactService(str(db_path))
    service.convert_history_id(history_id)
    service.convert_history_id(history_id)

    conn = user_db._connect()
    try:
        artifacts = conn.execute("SELECT * FROM derived_artifacts").fetchall()
        histories = conn.execute("SELECT * FROM download_history").fetchall()
    finally:
        conn.close()
    assert len(artifacts) == 1
    assert artifacts[0]["status"] == "ready"
    assert artifacts[0]["artifact_path"] != str(source)
    assert len(histories) == 1
    assert converted_commands[0][-1:] == ["--epub-version=3"]


def test_validation_rejects_traversal_and_persists_only_a_sanitized_error(tmp_path, monkeypatch):
    db_path = tmp_path / "users.db"
    user_db = UserDB(str(db_path))
    user_db.initialize()
    source = tmp_path / "Unsafe.azw3"
    source.write_bytes(b"azw3 source")
    conn = user_db._connect()
    try:
        history_id = conn.execute(
            """INSERT INTO download_history (task_id, source, title, format, final_status,
            download_path) VALUES (?, ?, ?, ?, ?, ?)""",
            ("unsafe", "test", "Unsafe", "azw3", "complete", str(source)),
        ).lastrowid
        conn.commit()
    finally:
        conn.close()

    def fake_convert(command, **_kwargs):
        with zipfile.ZipFile(command[2], "w") as archive:
            archive.writestr("../escaped.xhtml", "not safe")

    monkeypatch.setattr("shelfmark.core.derived_artifact_service.subprocess.run", fake_convert)
    DerivedArtifactService(str(db_path)).convert_history_id(history_id)

    conn = user_db._connect()
    try:
        artifact = conn.execute(
            "SELECT status, error_code, artifact_path FROM derived_artifacts"
        ).fetchone()
    finally:
        conn.close()
    assert artifact["status"] == "failed"
    assert artifact["error_code"] == "unsafe_archive"
    assert artifact["artifact_path"] is None


def test_cleanup_makes_artifact_unavailable_and_removes_output(tmp_path):
    db_path = tmp_path / "users.db"
    user_db = UserDB(str(db_path))
    user_db.initialize()
    output = tmp_path / "derived.epub"
    output.write_bytes(b"private artifact")
    conn = user_db._connect()
    try:
        history_id = conn.execute(
            "INSERT INTO download_history (task_id, source, title, final_status) VALUES (?, ?, ?, ?)",
            ("cleanup", "test", "Cleanup", "complete"),
        ).lastrowid
        conn.execute(
            """INSERT INTO derived_artifacts (source_history_id, source_hash, target_format,
            converter_version, normalized_options, artifact_path, status)
            VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (history_id, "a" * 64, "epub", "test", "{}", str(output), "ready"),
        )
        conn.commit()
    finally:
        conn.close()

    DerivedArtifactService(str(db_path)).cleanup_sources([history_id])

    conn = user_db._connect()
    try:
        artifact = conn.execute("SELECT status, artifact_path FROM derived_artifacts").fetchone()
    finally:
        conn.close()
    assert not output.exists()
    assert artifact["status"] == "deleted"
    assert artifact["artifact_path"] is None
