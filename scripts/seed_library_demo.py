# ruff: noqa: E402, I001
"""Seed a local Shelfmark library with three books for UI development.

Run with ``CONFIG_DIR=$PWD/.local/config uv run python scripts/seed_library_demo.py``.
"""

from __future__ import annotations

import os
import sqlite3
import sys
from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPOSITORY_ROOT))
os.environ.setdefault("LOG_ROOT", str(REPOSITORY_ROOT / ".local/log"))

from shelfmark.core.user_db import UserDB


CONFIG_DIR = Path(os.environ.get("CONFIG_DIR", ".local/config"))
DB_PATH = CONFIG_DIR / "users.db"
FILES_DIR = CONFIG_DIR.parent / "seed-files"

BOOKS = (
    ("openlibrary", "OL1W", "A Memory Called Empire", "Arkady Martine"),
    ("openlibrary", "OL2W", "The Left Hand of Darkness", "Ursula K. Le Guin"),
    ("openlibrary", "OL3W", "Piranesi", "Susanna Clarke"),
)


def main() -> None:
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    FILES_DIR.mkdir(parents=True, exist_ok=True)
    UserDB(str(DB_PATH)).initialize()

    epub_path = FILES_DIR / "a-memory-called-empire.epub"
    mobi_path = FILES_DIR / "a-memory-called-empire.mobi"
    epub_path.write_text("Demo EPUB placeholder\n")
    mobi_path.write_text("Demo MOBI placeholder\n")

    conn = sqlite3.connect(DB_PATH)
    try:
        conn.execute("INSERT OR IGNORE INTO users (id, username, role) VALUES (1, 'demo', 'admin')")
        for provider, provider_book_id, title, author in BOOKS:
            conn.execute(
                """
                INSERT OR IGNORE INTO books (metadata_provider, provider_book_id, title, author)
                VALUES (?, ?, ?, ?)
                """,
                (provider, provider_book_id, title, author),
            )

        book_ids = {
            provider_book_id: row[0]
            for provider_book_id, row in (
                (
                    provider_book_id,
                    conn.execute(
                        "SELECT id FROM books WHERE metadata_provider = ? AND provider_book_id = ?",
                        (provider, provider_book_id),
                    ).fetchone(),
                )
                for provider, provider_book_id, _, _ in BOOKS
            )
        }
        for book_id in book_ids.values():
            conn.execute(
                "INSERT OR IGNORE INTO user_library (user_id, book_id) VALUES (1, ?)", (book_id,)
            )

        files = (
            ("demo-memory-epub", book_ids["OL1W"], "EPUB", epub_path, "complete"),
            ("demo-memory-mobi", book_ids["OL1W"], "MOBI", mobi_path, "complete"),
            ("demo-piranesi-active", book_ids["OL3W"], None, None, "active"),
        )
        for task_id, book_id, file_format, path, status in files:
            conn.execute("DELETE FROM download_history WHERE task_id = ?", (task_id,))
            cursor = conn.execute(
                """
                INSERT INTO download_history (
                    task_id, user_id, source, title, format, final_status, download_path, book_id
                ) VALUES (?, 1, 'demo', ?, ?, ?, ?, ?)
                """,
                (
                    task_id,
                    next(
                        title
                        for _, provider_book_id, title, _ in BOOKS
                        if book_ids[provider_book_id] == book_id
                    ),
                    file_format,
                    status,
                    str(path) if path else None,
                    book_id,
                ),
            )
            if status == "complete":
                conn.execute(
                    "INSERT OR IGNORE INTO user_downloads (user_id, history_id) VALUES (1, ?)",
                    (cursor.lastrowid,),
                )
        conn.commit()
    finally:
        conn.close()

    print(f"Seeded Books 1-3 in {DB_PATH}")


if __name__ == "__main__":
    main()
