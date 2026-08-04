"""Tests for the needs-review routing decision in the import transfer path."""

from __future__ import annotations

import shelfmark.main as main_module


def test_empty_configured_formats_routes_any_zero_selection_release(monkeypatch):
    monkeypatch.setattr(
        main_module.app_config,
        "get",
        lambda key, default=None: {"IMPORT_NEEDS_REVIEW_FORMATS": []}.get(key, default),
    )
    assert main_module._should_route_to_needs_review([{"format": "epub"}])
    assert main_module._should_route_to_needs_review([{"format": "pdf"}])


def test_review_formats_only_route_matching_members(monkeypatch):
    monkeypatch.setattr(
        main_module.app_config,
        "get",
        lambda key, default=None: {"IMPORT_NEEDS_REVIEW_FORMATS": ["epub", "mobi"]}.get(
            key, default
        ),
    )
    assert main_module._should_route_to_needs_review([{"format": "epub"}])
    assert main_module._should_route_to_needs_review([{"format": "mobi"}])
    assert not main_module._should_route_to_needs_review([{"format": "pdf"}])
    assert not main_module._should_route_to_needs_review([{"format": "nfo"}])


def test_defaults_to_epub_when_unset(monkeypatch):
    configured_get = main_module.app_config.get
    monkeypatch.setattr(
        main_module.app_config, "get", lambda key, default=None: configured_get(key, default)
    )
    assert main_module._should_route_to_needs_review([{"format": "epub"}])
    assert not main_module._should_route_to_needs_review([{"format": "pdf"}])
