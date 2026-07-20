"""Tests for the Send-to-Kindle ``send_file_to_email`` helper (#05/#06)."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

import pytest

from shelfmark.download.outputs.email import (
    EmailOutputError,
    EmailSmtpConfig,
    _mask_recipient,
    send_file_to_email,
)


def test_mask_recipient_masks_local_part_only():
    assert _mask_recipient("alice@kindle.com") == "a***@kindle.com"
    assert _mask_recipient("a@kindle.com") == "a***@kindle.com"
    # No domain → returned as-is.
    assert _mask_recipient("not-an-email") == "not-an-email"
    assert _mask_recipient("") == ""


def test_send_file_to_email_raises_when_recipient_missing(tmp_path: Path):
    file_path = tmp_path / "book.epub"
    file_path.write_bytes(b"epub")
    with pytest.raises(EmailOutputError, match="No email recipient configured"):
        send_file_to_email(file_path, "")


def test_send_file_to_email_raises_when_file_missing(tmp_path: Path):
    with pytest.raises(EmailOutputError, match="File not found"):
        send_file_to_email(tmp_path / "missing.epub", "alice@kindle.com")


def test_send_file_to_email_composes_and_sends_then_returns_masked_recipient(
    tmp_path: Path,
):
    file_path = tmp_path / "book.epub"
    file_path.write_bytes(b"epub-content")

    fake_smtp_config = EmailSmtpConfig(
        host="smtp.example.com",
        port=587,
        security="starttls",
        username="user@example.com",
        password="pwd",
        from_addr="Shelfmark <user@example.com>",
    )
    with (
        patch(
            "shelfmark.download.outputs.email.build_email_smtp_config",
            return_value=fake_smtp_config,
        ) as fake_build,
        patch("shelfmark.download.outputs.email.send_email_message") as fake_send,
    ):
        masked = send_file_to_email(
            file_path,
            "alice@kindle.com",
            label="alice@kindle.com",
            subject="Ender's Game",
        )

    assert masked == "a***@kindle.com"
    fake_build.assert_called_once()
    fake_send.assert_called_once()
    _smtp_config, message = fake_send.call_args.args
    assert message["To"] == "alice@kindle.com"
    assert message["From"] == "Shelfmark <user@example.com>"
    assert message["Subject"] == "Ender's Game"
