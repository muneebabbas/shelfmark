"""Tests for building per-file download_history rows from a task's output paths."""

from __future__ import annotations

from types import SimpleNamespace

import shelfmark.main as main_module


def _task(library_paths, download_path):
    return SimpleNamespace(library_paths=library_paths, download_path=download_path)


def test_builds_rows_for_existing_files(tmp_path):
    epub = tmp_path / "Book.epub"
    epub.write_bytes(b"content")
    rows = main_module._build_download_file_rows(_task([str(epub)], None))
    assert rows == [{"download_path": str(epub), "format": "epub", "size": "7"}]


def test_skips_directory_paths(tmp_path):
    directory = tmp_path / "release"
    directory.mkdir()
    rows = main_module._build_download_file_rows(_task(None, str(directory)))
    assert rows == []


def test_skips_missing_paths(tmp_path):
    missing = tmp_path / "does-not-exist.epub"
    rows = main_module._build_download_file_rows(_task(None, str(missing)))
    assert rows == []
