"""Tests for the structured log formatter's handling of `extra` fields."""

from __future__ import annotations

import logging

from shelfmark.core.logger import _StructuredFormatter


def _fmt() -> _StructuredFormatter:
    return _StructuredFormatter("%(message)s")


def test_plain_record_is_unchanged_by_structured_formatter():
    record = logging.LogRecord("t", logging.INFO, "f.py", 1, "plain message", (), None)

    assert _fmt().format(record) == "plain message"


def test_extra_fields_are_rendered_as_json_suffix():
    record = logging.LogRecord("t", logging.WARNING, "f.py", 1, "list_books failed", (), None)
    record.action = "list_books"
    record.exc = ValueError("sensitive detail")

    output = _fmt().format(record)

    assert output.startswith("list_books failed {")
    assert '"action": "list_books"' in output
    assert '"sensitive detail"' in output
    # Dynamic formatter attributes must not be emitted as structured fields.
    assert '"message"' not in output
    assert '"asctime"' not in output


def test_exception_object_is_serialized_to_string():
    record = logging.LogRecord("t", logging.ERROR, "f.py", 1, "boom", (), None)
    record.exc_info = (ValueError, ValueError("boom detail"), None)
    record.exc = ValueError("boom detail")

    output = _fmt().format(record)

    assert '"boom detail"' in output
