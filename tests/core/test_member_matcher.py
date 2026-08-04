"""Tests for exact-affirmative source-member matching (feasibility for #68)."""

from __future__ import annotations

import zipfile

import pytest

from shelfmark.core.member_matcher import (
    MATCHER_VERSION,
    BookEvidence,
    MemberEvidence,
    _parse_metadata_xml,
    book_evidence_from_snapshot,
    decide,
    evaluate,
    extract_epub_metadata,
    normalize,
    parse_structured_member,
)
from tests.fixtures.collections import DUNE_FILES, DUNE_MOBI, EXPANSE_FILES

# ---------------------------------------------------------------- Book fixtures

BOOK_DUNE = BookEvidence(
    title="Dune",
    author="Frank Herbert",
    isbn="9783423026185",
    series="Dune",
    series_position=1.0,
)
BOOK_EXPANSE_1 = BookEvidence(
    title="Leviathan Wakes",
    author="James S. A. Corey",
    series="The Expanse",
    series_position=1.0,
)
BOOK_EXPANSE_2 = BookEvidence(
    title="Caliban's War",
    author="James S. A. Corey",
    series="The Expanse",
    series_position=2.0,
)


# ----------------------------------------------------------------- Normalization


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("Frank Herbert", "frank herbert"),
        ("James S. A. Corey", "james s a corey"),
        ("Caliban's War", "caliban s war"),
        ("Café & Bakery", "cafe and bakery"),
        ("The Expanse", "the expanse"),
    ],
)
def test_normalize(raw: str, expected: str) -> None:
    assert normalize(raw) == expected


def test_normalize_none_and_empty() -> None:
    assert normalize(None) == ""
    assert normalize("") == ""


# ------------------------------------------------------------- filename parsing


def test_parse_flat_series_file() -> None:
    evidence = parse_structured_member("Dune 01 Dune - Frank Herbert.epub")
    assert evidence == MemberEvidence(
        title="Dune", author="Frank Herbert", series="Dune", series_position=1.0
    )


def test_parse_nested_series_dir() -> None:
    evidence = parse_structured_member(
        "./The Expanse/The Expanse 01 Leviathan Wakes/Leviathan Wakes - James S. A. Corey.mobi"
    )
    assert evidence == MemberEvidence(
        title="Leviathan Wakes",
        author="James S. A. Corey",
        series="The Expanse",
        series_position=1.0,
    )


def test_parse_trailing_the_title() -> None:
    evidence = parse_structured_member(
        "./The Expanse/The Expanse 0.2 The Churn/Churn, The - James S. A. Corey.mobi"
    )
    assert evidence == MemberEvidence(
        title="The Churn", author="James S. A. Corey", series="The Expanse", series_position=0.2
    )


def test_parse_no_series() -> None:
    evidence = parse_structured_member("Dune Genesis - Frank Herbert.epub")
    assert evidence.title == "Dune Genesis"
    assert evidence.author == "Frank Herbert"
    assert evidence.series is None


# ----------------------------------------------------------------- safe positives


@pytest.mark.parametrize("suffix", [".epub", ".mobi"])
def test_dune_01_matches(suffix: str) -> None:
    evidence = parse_structured_member(f"Dune 01 Dune - Frank Herbert{suffix}")
    decision = decide(BOOK_DUNE, evidence)
    assert decision.auto_select is True


def test_expanse_leviathan_wakes_matches_book_1() -> None:
    evidence = parse_structured_member(EXPANSE_FILES[3])
    assert decide(BOOK_EXPANSE_1, evidence).auto_select is True


def test_expanse_calibans_war_matches_book_2() -> None:
    evidence = parse_structured_member(EXPANSE_FILES[4])
    assert decide(BOOK_EXPANSE_2, evidence).auto_select is True


# ----------------------------------------------------------- false-positive edges


@pytest.mark.parametrize("member", DUNE_FILES[1:] + DUNE_MOBI[1:])
def test_no_other_dune_member_matches(member: str) -> None:
    assert decide(BOOK_DUNE, parse_structured_member(member)).auto_select is False


@pytest.mark.parametrize("member", [f for f in DUNE_FILES if "Dune 01" not in f])
def test_dune_brief_guide_and_other_series_rejected(member: str) -> None:
    assert decide(BOOK_DUNE, parse_structured_member(member)).auto_select is False


@pytest.mark.parametrize("member", [f for f in EXPANSE_FILES if "Leviathan Wakes" not in f])
def test_expanse_only_leviathan_matches_book_1(member: str) -> None:
    assert decide(BOOK_EXPANSE_1, parse_structured_member(member)).auto_select is False


@pytest.mark.parametrize("member", [f for f in EXPANSE_FILES if "Caliban's War" not in f])
def test_expanse_only_calibans_war_matches_book_2(member: str) -> None:
    assert decide(BOOK_EXPANSE_2, parse_structured_member(member)).auto_select is False


# ------------------------------------------------------ ambiguity / incompleteness


def test_missing_position_is_ambiguous() -> None:
    evidence = parse_structured_member("Dune - Frank Herbert.epub")
    assert decide(BOOK_DUNE, evidence).auto_select is False


def test_title_only_is_insufficient() -> None:
    evidence = parse_structured_member("Dune.epub")
    assert decide(BOOK_DUNE, evidence).auto_select is False


def test_author_mismatch_is_not_exact() -> None:
    evidence = parse_structured_member("Dune 01 Dune - Not Frank Herbert.epub")
    assert decide(BOOK_DUNE, evidence).auto_select is False


def test_series_only_is_insufficient() -> None:
    evidence = MemberEvidence(series="Dune", series_position=1.0)
    assert decide(BOOK_DUNE, evidence).auto_select is False


def test_token_overlap_is_not_exact() -> None:
    evidence = parse_structured_member("Dune 01 Dune Nova - Frank Herbert.epub")
    assert decide(BOOK_DUNE, evidence).auto_select is False


def test_unreadable_member_without_filename_evidence_never_selects() -> None:
    result = evaluate(BOOK_DUNE, "Unknown Title - Unknown Author.epub", embedded=MemberEvidence())
    assert result["auto_select"] is False


def test_empty_embedded_still_uses_filename_evidence() -> None:
    result = evaluate(BOOK_DUNE, "Dune 01 Dune - Frank Herbert.epub", embedded=MemberEvidence())
    assert result["auto_select"] is True


def test_missing_author_is_not_exact() -> None:
    evidence = parse_structured_member("Dune 01 Dune.epub")
    assert decide(BOOK_DUNE, evidence).auto_select is False


# ---------------------------------------------------------------- contradiction


def test_isbn_match_with_contradicting_title_is_rejected() -> None:
    member = MemberEvidence(title="Dune Messiah", author="Frank Herbert", isbn="9783423026185")
    assert decide(BOOK_DUNE, member).auto_select is False


def test_isbn_match_is_affirmative() -> None:
    member = MemberEvidence(title="Dune", author="Frank Herbert", isbn="9783423026185")
    decision = decide(BOOK_DUNE, member)
    assert decision.auto_select is True
    assert decision.version == MATCHER_VERSION


def test_other_book_isbn_never_matches() -> None:
    member = MemberEvidence(title="Children of Dune", author="Frank Herbert", isbn="1234567890")
    assert decide(BOOK_DUNE, member).auto_select is False


def test_isbn_match_with_conflicting_position_is_rejected() -> None:
    member = MemberEvidence(
        title="Dune",
        author="Frank Herbert",
        isbn="9783423026185",
        series="Dune",
        series_position=2.0,
    )
    assert decide(BOOK_DUNE, member).auto_select is False


# ------------------------------------------------------------- EPUB metadata path


OPF = """<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf"
         xmlns:dc="http://purl.org/dc/elements/1.1/">
  <metadata>
    <dc:title>Dune</dc:title>
    <dc:creator>Frank Herbert</dc:creator>
    <dc:identifier opf:scheme="ISBN" xmlns:opf="http://www.idpf.org/2007/opf">
      9783423026185
    </dc:identifier>
    <meta name="calibre:series" content="Dune"/>
    <meta name="calibre:series_index" content="1"/>
  </metadata>
</package>
"""


def test_parse_metadata_xml() -> None:
    evidence = _parse_metadata_xml(OPF)
    assert evidence == MemberEvidence(
        title="Dune",
        author="Frank Herbert",
        isbn="9783423026185",
        series="Dune",
        series_position=1.0,
    )


SERIES_PREFIXED_OPF = """<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf"
         xmlns:dc="http://purl.org/dc/elements/1.1/">
  <metadata>
    <dc:title>Dune 01 Dune</dc:title>
    <dc:creator>Frank Herbert</dc:creator>
    <dc:identifier opf:scheme="ISBN" xmlns:opf="http://www.idpf.org/2007/opf">
      9780575081505
    </dc:identifier>
    <meta name="calibre:series" content="Dune"/>
    <meta name="calibre:series_index" content="1"/>
  </metadata>
</package>
"""


def test_embedded_series_prefixed_title_collapses_to_clean_title() -> None:
    """Real Calibre EPUBs embed 'Series NN Title'; it must collapse to the clean title."""
    evidence = _parse_metadata_xml(SERIES_PREFIXED_OPF)
    assert evidence.title == "Dune"
    assert evidence.series == "Dune"
    assert evidence.series_position == 1.0


def test_real_world_isbn_edition_mismatch_still_matches_via_series() -> None:
    """Provider ISBN differs from the file's edition ISBN; the series path must succeed."""
    embedded = _parse_metadata_xml(SERIES_PREFIXED_OPF)
    assert embedded.isbn == "9780575081505"
    assert decide(BOOK_DUNE, embedded).auto_select is True


def test_extract_epub_metadata(tmp_path) -> None:
    epub = tmp_path / "Dune 01 Dune - Frank Herbert.epub"
    with zipfile.ZipFile(epub, "w") as archive:
        archive.writestr(
            "META-INF/container.xml",
            '<container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>',
        )
        archive.writestr("OEBPS/content.opf", OPF)
    evidence = extract_epub_metadata(epub)
    assert evidence.isbn == "9783423026185"
    assert evidence.title == "Dune"
    assert evidence.author == "Frank Herbert"


def test_extract_epub_metadata_unreadable_returns_empty(tmp_path) -> None:
    bogus = tmp_path / "bogus.epub"
    bogus.write_bytes(b"not a zip")
    assert extract_epub_metadata(bogus).empty


def test_embedded_metadata_overrides_filename() -> None:
    embedded = MemberEvidence(
        title="Dune",
        author="Frank Herbert",
        isbn="9783423026185",
        series="Dune",
        series_position=1.0,
    )
    result = evaluate(BOOK_DUNE, "Dune 01 Dune - Frank Herbert.epub", embedded=embedded)
    assert result["auto_select"] is True
    assert result["member_evidence"]["isbn"] == "9783423026185"


# ------------------------------------------------------------------ snapshots


def test_book_evidence_from_snapshot() -> None:
    snapshot = {
        "title": "Dune",
        "author": "Frank Herbert",
        "series_name": "Dune",
        "series_position": 1.0,
        "isbn_13": "9783423026185",
        "metadata_json": {},
    }
    assert book_evidence_from_snapshot(snapshot) == BOOK_DUNE
