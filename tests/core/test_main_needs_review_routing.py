"""Tests for the needs-review routing decision in the import transfer path.

A release is routed to the administrator Inbox when a review-required format
(default ``epub``) is present among the release's members but was not imported
-- regardless of whether other formats *were* imported. The caller supplies the
formats present on the release and the formats actually selected for import.
"""

from __future__ import annotations

import shelfmark.main as main_module


def test_review_required_format_present_but_not_imported_routes(monkeypatch):
    monkeypatch.setattr(
        main_module.app_config,
        "get",
        lambda key, default=None: {"IMPORT_NEEDS_REVIEW_FORMATS": ["epub"]}.get(key, default),
    )
    assert main_module._should_route_to_needs_review(["epub", "mobi"], ["mobi"])


def test_no_review_required_format_never_routes(monkeypatch):
    monkeypatch.setattr(
        main_module.app_config,
        "get",
        lambda key, default=None: {"IMPORT_NEEDS_REVIEW_FORMATS": ["epub"]}.get(key, default),
    )
    assert not main_module._should_route_to_needs_review(["mobi", "pdf"], ["mobi"])
    assert not main_module._should_route_to_needs_review(["mobi", "pdf"], [])


def test_review_required_format_imported_does_not_route(monkeypatch):
    monkeypatch.setattr(
        main_module.app_config,
        "get",
        lambda key, default=None: {"IMPORT_NEEDS_REVIEW_FORMATS": ["epub"]}.get(key, default),
    )
    assert not main_module._should_route_to_needs_review(["epub", "mobi"], ["epub"])
    assert not main_module._should_route_to_needs_review(["epub"], ["epub"])


def test_zero_imports_still_routes_when_review_format_present(monkeypatch):
    monkeypatch.setattr(
        main_module.app_config,
        "get",
        lambda key, default=None: {"IMPORT_NEEDS_REVIEW_FORMATS": ["epub"]}.get(key, default),
    )
    assert main_module._should_route_to_needs_review(["epub"], [])
    assert main_module._should_route_to_needs_review(["epub", "mobi"], [])


def test_multiple_review_formats_route_when_any_is_missing(monkeypatch):
    monkeypatch.setattr(
        main_module.app_config,
        "get",
        lambda key, default=None: {"IMPORT_NEEDS_REVIEW_FORMATS": ["epub", "mobi"]}.get(
            key, default
        ),
    )
    assert main_module._should_route_to_needs_review(["epub", "mobi"], ["epub"])
    assert main_module._should_route_to_needs_review(["epub", "mobi"], ["mobi"])
    assert not main_module._should_route_to_needs_review(["epub", "mobi"], ["epub", "mobi"])


def test_defaults_to_epub_when_unset(monkeypatch):
    configured_get = main_module.app_config.get
    monkeypatch.setattr(
        main_module.app_config, "get", lambda key, default=None: configured_get(key, default)
    )
    assert main_module._should_route_to_needs_review(["epub"], [])
    assert not main_module._should_route_to_needs_review(["pdf"], [])
    assert main_module._should_route_to_needs_review(["epub", "pdf"], ["pdf"])


def test_empty_configured_formats_treats_every_format_as_review_required(monkeypatch):
    monkeypatch.setattr(
        main_module.app_config,
        "get",
        lambda key, default=None: {"IMPORT_NEEDS_REVIEW_FORMATS": []}.get(key, default),
    )
    assert main_module._should_route_to_needs_review(["pdf"], [])
    assert main_module._should_route_to_needs_review(["mobi"], [])
    assert not main_module._should_route_to_needs_review(["pdf"], ["pdf"])
