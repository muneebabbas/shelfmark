"""Feasibility demonstration: can static matching auto-select only exact members?

Runs the exact-affirmative matcher (``shelfmark.core.member_matcher``) over the
reference Dune and Expanse collections against the locally-seeded Books and
prints which retained source members would be auto-selected.

Usage:
    uv run --env-file shelfmark/.env python scripts/match_feasibility.py [--db PATH] [--dune-ids 22] [--expanse-ids 23 24]

By default reads BOOK 22 (Dune), 23 & 24 (The Expanse) from the disposable
local library database at .local/config/users.db.
"""

from __future__ import annotations

import argparse
import os
import sqlite3
import sys
from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPOSITORY_ROOT))
os.environ.setdefault("LOG_ROOT", str(REPOSITORY_ROOT / ".local/log"))

from shelfmark.core.member_matcher import (  # noqa: E402
    BookEvidence,
    book_evidence_from_snapshot,
    evaluate,
)
from tests.fixtures.collections import DUNE_FILES, EXPANSE_FILES  # noqa: E402


def load_book(conn: sqlite3.Connection, book_id: int) -> BookEvidence:
    row = conn.execute("SELECT * FROM books WHERE id = ?", (book_id,)).fetchone()
    if row is None:
        msg = f"book {book_id} not found in database"
        raise SystemExit(msg)
    return book_evidence_from_snapshot(dict(row))


def run(book: BookEvidence, label: str, members: list[tuple[str, str]]) -> None:
    matched = [path for path, _ in members if evaluate(book, path)["auto_select"]]
    print(
        f"\n[{label}]  {book.title} — {book.author}"
        f" (series={book.series} pos={book.series_position})"
    )
    print(f"    would auto-select ({len(matched)} of {len(members)} members):")
    if not matched:
        print("      (none)")
    for path in matched:
        print(f"      AUTO  {path}")
    for path, _ in members:
        result = evaluate(book, path)
        if not result["auto_select"]:
            print(f"      skip  {path}\n            -> {result['reason']}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", default=str(Path(".local/config/users.db").resolve()))
    parser.add_argument("--dune-ids", nargs="*", type=int, default=[22])
    parser.add_argument("--expanse-ids", nargs="*", type=int, default=[23, 24])
    args = parser.parse_args()

    conn = sqlite3.connect(args.db)
    conn.row_factory = sqlite3.Row

    dune_members = [(name, "epub") for name in DUNE_FILES]
    dune_members += [(name.replace(".epub", ".mobi"), "mobi") for name in DUNE_FILES]
    expanse_members = [(name, name.rsplit(".", 1)[-1]) for name in EXPANSE_FILES]

    for book_id in args.dune_ids:
        run(load_book(conn, book_id), f"Dune book {book_id}", dune_members)
    for book_id in args.expanse_ids:
        run(load_book(conn, book_id), f"Expanse book {book_id}", expanse_members)


if __name__ == "__main__":
    main()
