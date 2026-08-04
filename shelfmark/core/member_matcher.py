"""Exact-affirmative matching of retained source members to a target Book.

This module establishes the feasibility of *automatically* selecting only the
source members that are affirmatively, exactly the target Book -- replacing the
current "default-all-supported" planner behaviour (``shelfmark/main.py``
``_transfer_default_import_selection``) which retends run as a proof of concept
and is not yet wired into import planning.

Safety boundary (issue #60, #68): a member is auto-selected *only* when its
evidence affirmatively resolves to exactly the target Book. Title-only,
series-only, token-overlap, fuzzy, ambiguous, contradictory, or other-Book
evidence never auto-selects -- such members stay available for manual
administrator selection.
"""

from __future__ import annotations

import re
import unicodedata
import zipfile
from dataclasses import dataclass, replace
from pathlib import Path
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from collections.abc import Mapping

from defusedxml import ElementTree as DefusedElementTree

# Bump whenever the matching rules or normalization change so that stored
# decisions remain auditable against the exact ruleset that produced them.
MATCHER_VERSION = "exact/v1"

_NON_WORD = re.compile(r"[^a-z0-9]+")
_SERIES_PREFIX = re.compile(r"^(?P<series>.+?)\s+(?P<pos>\d+(?:\.\d+)?)\s+(?P<title>.+)$")
_ISBN = re.compile(r"(?:\d[- ]*){9}[\dXx]")


@dataclass(frozen=True)
class MemberEvidence:
    """Normalized-able facts we can extract about a source member."""

    title: str | None = None
    author: str | None = None
    isbn: str | None = None
    series: str | None = None
    series_position: float | None = None

    @property
    def empty(self) -> bool:
        return not any((self.title, self.author, self.isbn, self.series, self.series_position))


@dataclass(frozen=True)
class BookEvidence:
    """Affirmative target facts about a Book (from its snapshot / DB row)."""

    title: str
    author: str
    isbn: str | None = None
    series: str | None = None
    series_position: float | None = None


@dataclass(frozen=True)
class MatchDecision:
    auto_select: bool
    reason: str
    version: str = MATCHER_VERSION


def normalize(value: str | None) -> str:
    """Fold text for exact comparison: accents, case, punctuation, '&'."""
    if not value:
        return ""
    decomposed = unicodedata.normalize("NFKD", str(value))
    without_marks = "".join(char for char in decomposed if not unicodedata.combining(char))
    lowered = without_marks.casefold().replace("&", " and ")
    return " ".join(_NON_WORD.sub(" ", lowered).split())


def book_evidence_from_snapshot(snapshot: Mapping[str, Any]) -> BookEvidence:
    """Build target evidence from a Book row or an import-activity snapshot."""
    metadata = snapshot.get("metadata_json") or {}
    if isinstance(metadata, str):
        import json

        try:
            metadata = json.loads(metadata)
        except TypeError, ValueError:
            metadata = {}
    isbn = snapshot.get("isbn_13") or metadata.get("isbn_13") or metadata.get("isbn_10")
    return BookEvidence(
        title=str(snapshot.get("title") or ""),
        author=str(snapshot.get("author") or ""),
        isbn=_clean_isbn(str(isbn)) if isbn else None,
        series=str(snapshot.get("series_name") or metadata.get("series_name") or ""),
        series_position=_as_float(snapshot.get("series_position")),
    )


def _clean_isbn(value: str) -> str:
    return "".join(char for char in value if char.isdigit() or char in "xX").upper()


def _as_float(value: Any) -> float | None:
    try:
        return float(value)
    except TypeError, ValueError:
        return None


def _flip_trailing_the(title: str) -> str:
    """Turn ``"Butcher of Anderson Station, The"`` into ``"The Butcher ..."``."""
    stripped = title.strip()
    if stripped.lower().endswith(", the"):
        return "The " + stripped[:-5].strip()
    return stripped


def _parse_series_prefix(text: str) -> tuple[str, float, str] | None:
    """Parse ``"Series 02 Title"`` -> ``("Series", 2.0, "Title")`` or ``None``."""
    match = _SERIES_PREFIX.match(text.strip())
    if not match:
        return None
    position = _as_float(match.group("pos"))
    if position is None:
        return None
    return match.group("series").strip(), position, match.group("title").strip()


def parse_structured_member(relative_path: str | Path) -> MemberEvidence:
    """Extract title/author/series/position evidence from a structured path/filename.

    Handles both flat ``"Series 02 Title - Author.ext"`` files and nested
    ``"Series 02 Title/Title - Author.ext"`` layouts (reading series/position
    from the containing directory when the filename itself carries none).
    """
    raw = str(relative_path).replace("\\", "/")
    parts = [part for part in raw.split("/") if part and part != "."]
    if not parts:
        return MemberEvidence()

    leaf = Path(parts[-1])
    stem = leaf.stem

    title: str | None = None
    author: str | None = None
    if " - " in stem:
        head, _, tail = stem.rpartition(" - ")
        title = _flip_trailing_the(head) or None
        author = tail.strip() or None
    else:
        title = _flip_trailing_the(stem) or None

    series: str | None = None
    position: float | None = None
    for directory in reversed(parts[:-1]):
        parsed = _parse_series_prefix(directory)
        if parsed:
            series, position, _ = parsed
            break

    if series is None and title:
        parsed = _parse_series_prefix(title)
        if parsed:
            candidate_series, candidate_position, candidate_title = parsed
            series, position, title = candidate_series, candidate_position, candidate_title

    return MemberEvidence(title=title, author=author, series=series, series_position=position)


def _parse_metadata_xml(xml_text: str) -> MemberEvidence:
    """Extract title/creators/ISBN/series from an EPUB ``content.opf`` document."""
    root = DefusedElementTree.fromstring(xml_text)

    def text_of(*local_names: str) -> str | None:
        for node in root.iter():
            local = node.tag.rsplit("}", 1)[-1]
            if local in local_names and node.text:
                return " ".join(node.text.split())
        return None

    title = text_of("title")
    author = None
    authors = [
        node.text.strip() for node in root.iter() if node.tag.endswith("}creator") and node.text
    ]
    if authors:
        author = authors[0]

    isbn: str | None = None
    for node in root.iter():
        if node.tag.endswith("}identifier") and node.text:
            scheme = (node.attrib.get("{http://www.idpf.org/2007/opf}scheme") or "").upper()
            if scheme == "ISBN" or _ISBN.search(node.text):
                candidate = _clean_isbn(node.text)
                if _looks_like_isbn(candidate):
                    isbn = candidate
                    break

    series: str | None = None
    position: float | None = None
    for meta in root.iter():
        if meta.tag.endswith("}meta"):
            name = (meta.attrib.get("name") or "").lower()
            content = (meta.attrib.get("content") or "").strip()
            if name in ("calibre:series", "series") and content:
                series = content
            elif name in ("calibre:series_index", "series index") and content:
                position = _as_float(content)

    return MemberEvidence(
        title=title, author=author, isbn=isbn, series=series, series_position=position
    )


def _looks_like_isbn(value: str) -> bool:
    return bool(value) and all(char.isdigit() or char in "xX" for char in value)


def extract_epub_metadata(path: str | Path) -> MemberEvidence:
    """Read embedded metadata from an EPUB file; returns empty evidence on failure."""
    try:
        with zipfile.ZipFile(path) as archive:
            container = archive.read("META-INF/container.xml").decode("utf-8", "replace")
            rootfile = re.search(r'full-path\s*=\s*"([^"]+)"', container, flags=re.IGNORECASE)
            if not rootfile:
                return MemberEvidence()
            opf = archive.read(rootfile.group(1)).decode("utf-8", "replace")
        return _parse_metadata_xml(opf)
    except OSError, zipfile.BadZipFile, KeyError, DefusedElementTree.ParseError:
        return MemberEvidence()


def _merged(filename_evidence: MemberEvidence, embedded: MemberEvidence | None) -> MemberEvidence:
    """Embedded metadata is stronger evidence than the filename; prefer it when present."""
    if embedded is None or embedded.empty:
        return filename_evidence
    return replace(
        filename_evidence,
        title=embedded.title or filename_evidence.title,
        author=embedded.author or filename_evidence.author,
        isbn=embedded.isbn or filename_evidence.isbn,
        series=embedded.series or filename_evidence.series,
        series_position=(
            embedded.series_position
            if embedded.series_position is not None
            else filename_evidence.series_position
        ),
    )


def decide(book: BookEvidence, member: MemberEvidence) -> MatchDecision:
    """Decide whether a member is an affirmatively exact match for ``book``."""
    b_title, b_author, b_series = (
        normalize(book.title),
        normalize(book.author),
        normalize(book.series),
    )
    b_isbn, b_pos = normalize(book.isbn), book.series_position
    m_title, m_author, m_series = (
        normalize(member.title),
        normalize(member.author),
        normalize(member.series),
    )
    m_isbn, m_pos = normalize(member.isbn), member.series_position

    title_ok = bool(m_title) and m_title == b_title
    author_ok = bool(m_author) and m_author == b_author
    series_ok = (not b_series) or (bool(m_series) and m_series == b_series)
    position_ok = b_pos is None or (m_pos is not None and m_pos == b_pos)
    isbn_hit = bool(b_isbn) and bool(m_isbn) and m_isbn == b_isbn

    if isbn_hit:
        contradicts = (m_title and m_title != b_title) or (m_author and m_author != b_author)
        contradicts = contradicts or (b_series and m_series and m_series != b_series)
        contradicts = contradicts or (b_pos is not None and m_pos is not None and m_pos != b_pos)
        if contradicts:
            return MatchDecision(
                False, "conflict: isbn matches but title/author/series/position disagree"
            )
        return MatchDecision(True, "embedded isbn matches the book")

    if title_ok and author_ok and series_ok and position_ok:
        dimension = "series" if b_series else "title+author"
        return MatchDecision(True, f"exact {dimension} match")

    if not title_ok:
        return MatchDecision(False, "no match: title does not match")
    if not author_ok:
        return MatchDecision(False, "no match: author does not match")
    if not series_ok:
        return MatchDecision(False, "no match: series does not match")
    if not position_ok:
        return MatchDecision(False, "no match: series position does not match")
    return MatchDecision(False, "no match: incomplete or conflicting evidence")


def evaluate(
    book: BookEvidence,
    relative_path: str | Path,
    embedded: MemberEvidence | None = None,
) -> dict[str, Any]:
    """One-stop evaluation returning a selection-evidence dict for audit/demo."""
    evidence = _merged(parse_structured_member(relative_path), embedded)
    decision = decide(book, evidence)
    return {
        "auto_select": decision.auto_select,
        "matcher": decision.version,
        "reason": decision.reason,
        "member_evidence": {
            "title": evidence.title,
            "author": evidence.author,
            "isbn": evidence.isbn,
            "series": evidence.series,
            "series_position": evidence.series_position,
        },
    }
