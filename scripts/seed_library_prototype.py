#!/usr/bin/env python3
"""Prototype seed script for ticket #08 — book detail page UI.

Usage::

    CONFIG_DIR=.local/config uv run python scripts/seed_library_prototype.py

Idempotent. Wipes the prototype-scoped rows it owns (recognised via a
``origin = 'prototype-seed'`` sentinel on download_history rows and a
corresponding convention for books: metadata_provider ``prototype``), then
re-inserts a fixed fixture set covering every state #08 needs to render:

* Book 1 — multi-format files on disk (EPUB + MOBI), one MOBI not linked to the
  prototype user (exercises ``downloadable_by_me=False`` for non-admin auth
  modes — under AUTH_METHOD=none everyone is admin so this reads as ``True``,
  but the state still exists in the data).
* Book 2 — no files on disk (exercises the empty state + auto-open Find
  Releases per #02 sub-decision 5).
* Book 3 — multi-format files including one in-flight row (exercises the
  in-flight indicator + the in-flight Unlink-disabled-with-tooltip decision).

This script exists *only* to support the #08 prototype. It is not the path
that production uses to populate the library — that path is the
``POST /api/library/books`` Add flow per #02 / #04.
"""

from __future__ import annotations

import json
import os
import sqlite3
import sys
from datetime import UTC, datetime
from pathlib import Path

# Ensure the shelfmark package is importable when run via `uv run python` from
# the repo root without needing the package installed.
_REPO_ROOT = Path(__file__).resolve().parents[1]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from shelfmark.core.user_db import UserDB  # noqa: E402

# Under AUTH_METHOD=none the library_routes' actor context resolves to
# (db_user_id=0, is_admin=True, owner_scope=None) — see library_routes.py:76-78.
# There's no real users row, but `user_library(user_id=0, book_id=...)` is a
# valid link row (the schema doesn't FK user_library.user_id to users.id).
_PROTOTYPE_USER_ID = 0
_PROTOTYPE_ORIGIN = "prototype-seed"
_PROTOTYPE_PROVIDER = "prototype"


def _resolve_db_path() -> Path:
    """Resolve the users.db path matching the Flask backend's behaviour."""
    config_dir = Path(os.environ.get("CONFIG_DIR", "/config"))
    config_dir.mkdir(parents=True, exist_ok=True)
    return config_dir / "users.db"


def _wipe_prototype_rows(conn: sqlite3.Connection) -> None:
    """Remove all rows previously seeded by this script.

    Does NOT drop the synthetic prototype-admin users(0) row — it's the
    stable anchor for every subsequent re-seed's FK. Truncating it each run
    would force a CASCADE delete through everything else, which is awkward
    given user_library rows might be mid-INSERT.
    """
    conn.execute(
        "DELETE FROM user_downloads WHERE user_id = ?",
        (_PROTOTYPE_USER_ID,),
    )
    # Book ids for prototype books (metadata_provider = 'prototype' OR origin =
    # 'prototype-seed' on history rows) are discovered after the history DELETE
    # because user_downloads FK to download_history.
    prototype_history_ids = [
        row[0]
        for row in conn.execute(
            "SELECT id FROM download_history WHERE origin = ?",
            (_PROTOTYPE_ORIGIN,),
        )
    ]
    if prototype_history_ids:
        placeholders = ",".join("?" for _ in prototype_history_ids)
        conn.execute(
            f"DELETE FROM user_downloads WHERE history_id IN ({placeholders})",
            prototype_history_ids,
        )
    conn.execute(
        "DELETE FROM download_history WHERE origin = ?",
        (_PROTOTYPE_ORIGIN,),
    )
    # Delete prototype books + their user_library rows.
    prototype_book_ids = [
        row[0]
        for row in conn.execute(
            "SELECT id FROM books WHERE metadata_provider = ?",
            (_PROTOTYPE_PROVIDER,),
        )
    ]
    for book_id in prototype_book_ids:
        conn.execute(
            "DELETE FROM user_library WHERE book_id = ?",
            (book_id,),
        )
    conn.execute(
        "DELETE FROM books WHERE metadata_provider = ?",
        (_PROTOTYPE_PROVIDER,),
    )


def _now_iso() -> str:
    return datetime.now(UTC).isoformat()


def _insert_book(
    conn: sqlite3.Connection,
    *,
    provider_book_id: str,
    title: str,
    author: str,
    subtitle: str | None,
    publish_year: int | None,
    isbn_13: str | None,
    series_name: str | None,
    series_position: float | None,
    language: str,
    description: str,
) -> int:
    """Insert a book row tagged with the prototype provider.

    Idempotent on UNIQUE(metadata_provider, provider_book_id). Re-running the
    seed script wipes prototype rows first via _wipe_prototype_rows, so the
    INSERT path always runs on a clean slate.
    """
    existing = conn.execute(
        "SELECT id FROM books WHERE metadata_provider = ? AND provider_book_id = ?",
        (_PROTOTYPE_PROVIDER, provider_book_id),
    ).fetchone()
    if existing is not None:
        return int(existing["id"])
    cursor = conn.execute(
        """
        INSERT INTO books (
            metadata_provider, provider_book_id, title, author,
            subtitle, publish_year, isbn_13, cover_url,
            series_name, series_position, language, metadata_json,
            created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            _PROTOTYPE_PROVIDER,
            provider_book_id,
            title,
            author,
            subtitle,
            publish_year,
            isbn_13,
            None,
            series_name,
            series_position,
            language,
            json.dumps({"description": description}, ensure_ascii=False),
            _now_iso(),
            _now_iso(),
        ),
    )
    last_row_id = cursor.lastrowid
    if last_row_id is None:
        msg = "Failed to insert book row"
        raise RuntimeError(msg)
    return int(last_row_id)


def _insert_download_history_row(
    conn: sqlite3.Connection,
    *,
    book_id: int,
    task_id: str,
    title: str,
    author: str,
    source: str,
    source_display_name: str,
    fmt: str,
    size: int,
    content_type: str,
    final_status: str,
    download_path: str | None,
) -> int:
    """Insert a download_history row tagged with the prototype origin."""
    cursor = conn.execute(
        """
        INSERT INTO download_history (
            task_id, user_id, username, source, source_display_name,
            title, author, format, size, content_type, origin,
            final_status, download_path, queued_at, terminal_at, book_id
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            task_id,
            _PROTOTYPE_USER_ID,
            "prototype",
            source,
            source_display_name,
            title,
            author,
            fmt,
            size,
            content_type,
            _PROTOTYPE_ORIGIN,
            final_status,
            download_path,
            _now_iso(),
            _now_iso(),
            book_id,
        ),
    )
    last_row_id = cursor.lastrowid
    if last_row_id is None:
        msg = "Failed to insert download_history row"
        raise RuntimeError(msg)
    return int(last_row_id)


def _link_download_to_user(
    conn: sqlite3.Connection,
    *,
    history_id: int,
    book_id: int,
) -> None:
    conn.execute(
        """
        INSERT OR IGNORE INTO user_downloads (user_id, history_id, book_id, linked_at)
        VALUES (?, ?, ?, ?)
        """,
        (_PROTOTYPE_USER_ID, history_id, book_id, _now_iso()),
    )


def _ensure_user_downloads_column(conn: sqlite3.Connection) -> None:
    """Defensive: the user_downloads table is created by UserDB.initialize().

    We re-initialise before seeding, so the table exists; this is a no-op guard.
    """
    cols = {
        str(col["name"]) for col in conn.execute("PRAGMA table_info(user_downloads)").fetchall()
    }
    if "book_id" not in cols:
        conn.execute("ALTER TABLE user_downloads ADD COLUMN book_id INTEGER")
    if "linked_at" not in cols:
        conn.execute("ALTER TABLE user_downloads ADD COLUMN linked_at TEXT")


def _ensure_prototype_user_row(conn: sqlite3.Connection) -> None:
    """Insert the synthetic users(id=0) row that holds prototype links.

    Under AUTH_METHOD=none, library_routes resolves the actor to
    (db_user_id=0, is_admin=True, owner_scope=None). `user_library.user_id`
    and `user_downloads.user_id` FK to users(id), so we need a users(0) row
    for the seed's `INSERT INTO user_library(user_id=0, ...)` to satisfy the
    FK. The row is otherwise inert (it's never logged into).
    """
    conn.execute(
        """
        INSERT OR IGNORE INTO users (id, username, email, display_name, auth_source, role)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (_PROTOTYPE_USER_ID, "prototype-admin", None, "Prototype admin", "builtin", "admin"),
    )


def _link_book_to_user(conn: sqlite3.Connection, *, book_id: int) -> None:
    """Insert the user_library(book_id, ...) link row for the prototype user."""
    conn.execute(
        """
        INSERT OR IGNORE INTO user_library (user_id, book_id, added_at)
        VALUES (?, ?, ?)
        """,
        (_PROTOTYPE_USER_ID, book_id, _now_iso()),
    )


def _seed_book_1_files_on_disk(conn: sqlite3.Connection) -> int:
    """Multi-format, multi-release book with EPUB + MOBI on disk."""
    book_id = _insert_book(
        conn,
        provider_book_id="prototype-1",
        title="The Prefect",
        author="Alastair Reynolds",
        subtitle="A Prefect Dreyfus Emergency",
        publish_year=2007,
        isbn_13="9780575077696",
        series_name="Prefect Dreyfus",
        series_position=1.0,
        language="en",
        description="A science fiction novel set in the Revelation Space universe.",
    )
    _link_book_to_user(conn, book_id=book_id)

    # EPUB v1 — linked to prototype user
    epub_h1 = _insert_download_history_row(
        conn,
        book_id=book_id,
        task_id="prototype-book1-epub-v1",
        title="The Prefect",
        author="Alastair Reynolds",
        source="libgen",
        source_display_name="Libgen",
        fmt="epub",
        size=482_109,
        content_type="ebook",
        final_status="complete",
        download_path="/books/prototype/the-prefect-v1.epub",
    )
    _link_download_to_user(conn, history_id=epub_h1, book_id=book_id)

    # MOBI — linked to prototype user
    mobi_h1 = _insert_download_history_row(
        conn,
        book_id=book_id,
        task_id="prototype-book1-mobi-v1",
        title="The Prefect",
        author="Alastair Reynolds",
        source="annas-archive",
        source_display_name="Anna’s Archive",
        fmt="mobi",
        size=612_440,
        content_type="ebook",
        final_status="complete",
        download_path="/books/prototype/the-prefect.mobi",
    )
    _link_download_to_user(conn, history_id=mobi_h1, book_id=book_id)

    # EPUB v2 — alternate release; not linked (would surface as
    # ``downloadable_by_me=False`` under a non-admin auth mode)
    _insert_download_history_row(
        conn,
        book_id=book_id,
        task_id="prototype-book1-epub-v2",
        title="The Prefect",
        author="Alastair Reynolds",
        source="libgen",
        source_display_name="Libgen",
        fmt="epub",
        size=488_002,
        content_type="ebook",
        final_status="complete",
        download_path="/books/prototype/the-prefect-v2.epub",
    )
    return book_id


def _seed_book_2_no_files(conn: sqlite3.Connection) -> int:
    """File-less library entry (wishlist semantics per #01)."""
    book_id = _insert_book(
        conn,
        provider_book_id="prototype-2",
        title="The Ghost in the Machine",
        author="Erik P. Vermeulen",
        subtitle=None,
        publish_year=2021,
        isbn_13="9780575077702",
        series_name=None,
        series_position=None,
        language="en",
        description="A whodunnit set in a near-future Rotterdam.",
    )
    _link_book_to_user(conn, book_id=book_id)
    return book_id


def _seed_book_3_in_flight(conn: sqlite3.Connection) -> int:
    """Book with one complete EPUB + one in-flight AZW3."""
    book_id = _insert_book(
        conn,
        provider_book_id="prototype-3",
        title="Chasm City",
        author="Alastair Reynolds",
        subtitle=None,
        publish_year=2001,
        isbn_13="9780575083055",
        series_name=None,
        series_position=None,
        language="en",
        description="A standalone novel in the Revelation Space universe.",
    )
    _link_book_to_user(conn, book_id=book_id)

    epub_h = _insert_download_history_row(
        conn,
        book_id=book_id,
        task_id="prototype-book3-epub-v1",
        title="Chasm City",
        author="Alastair Reynolds",
        source="libgen",
        source_display_name="Libgen",
        fmt="epub",
        size=521_440,
        content_type="ebook",
        final_status="complete",
        download_path="/books/prototype/chasm-city.epub",
    )
    _link_download_to_user(conn, history_id=epub_h, book_id=book_id)

    # In-flight row — no download_path; surfaces in the in_flight array.
    _insert_download_history_row(
        conn,
        book_id=book_id,
        task_id="prototype-book3-azw3-v1",
        title="Chasm City",
        author="Alastair Reynolds",
        source="annas-archive",
        source_display_name="Anna’s Archive",
        fmt="azw3",
        size=0,
        content_type="ebook",
        final_status="active",
        download_path=None,
    )
    return book_id


def main() -> int:
    db_path = _resolve_db_path()
    print(f"[seed] Using users.db at: {db_path}")

    # Initialise schema (creates `books`, `user_library`, `user_downloads`,
    # `download_history`, and runs the migration adding
    # `download_history.book_id`).
    user_db = UserDB(str(db_path))
    user_db.initialize()
    print("[seed] UserDB.initialize() complete — tables confirmed")

    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        _ensure_user_downloads_column(conn)
        _ensure_prototype_user_row(conn)
        _wipe_prototype_rows(conn)
        conn.commit()

        book1 = _seed_book_1_files_on_disk(conn)
        book2 = _seed_book_2_no_files(conn)
        book3 = _seed_book_3_in_flight(conn)
        conn.commit()
    finally:
        conn.close()

    print(f"[seed] book 1 id = {book1}  (The Prefect — EPUB+MOBI on disk)")
    print(f"[seed] book 2 id = {book2}  (The Ghost in the Machine — no files)")
    print(f"[seed] book 3 id = {book3}  (Chasm City — EPUB + in-flight AZW3)")
    print()
    print("Prototype URLs (assuming AUTH_METHOD=none on port 8084):")
    print(f"  http://localhost:8084/library/{book1}  — files-exist case")
    print(f"  http://localhost:8084/library/{book2}  — empty-state case (auto-opens Find Releases)")
    print(f"  http://localhost:8084/library/{book3}  — in-flight case")
    print()
    print("Re-run anytime — idempotent.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
