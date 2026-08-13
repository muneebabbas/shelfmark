"""Private AZW3-to-EPUB derived artifact conversion service."""

from __future__ import annotations

import hashlib
import json
import os
import resource
import shutil
import sqlite3
import stat
import subprocess
import tempfile
import threading
import zipfile
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from xml.etree import ElementTree

from defusedxml import ElementTree as DefusedElementTree
from defusedxml.common import DefusedXmlException

from shelfmark.config.env import TMP_DIR
from shelfmark.core.logger import setup_logger
from shelfmark.core.notifications import NotificationContext, NotificationEvent, notify_admin
from shelfmark.core.request_helpers import now_utc_iso
from shelfmark.download.fs import run_blocking_io

logger = setup_logger(__name__)

TARGET_FORMAT = "epub"
CONVERTER_PATH = Path(os.environ.get("CALIBRE_EBOOK_CONVERT", "/usr/bin/ebook-convert"))
CONVERTER_VERSION = os.environ.get("CALIBRE_VERSION", "unknown")
CONVERSION_TIMEOUT_SECONDS = 300
MAX_OUTPUT_BYTES = 500 * 1024 * 1024
MAX_EPUB_MEMBERS = 10_000
MAX_EPUB_UNCOMPRESSED_BYTES = 1024 * 1024 * 1024
MAX_CONVERTER_MEMORY_BYTES = 2 * 1024 * 1024 * 1024
MAX_CONVERTER_LOG_CHARS = 16_384


class ArtifactValidationError(ValueError):
    """Raised when converted output is not a safe, usable EPUB."""


@dataclass(frozen=True)
class SourceFile:
    history_id: int
    book_id: int | None
    path: Path


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _safe_zip_name(name: str) -> PurePosixPath:
    path = PurePosixPath(name)
    if not name or "\x00" in name or path.is_absolute() or ".." in path.parts:
        raise ArtifactValidationError("unsafe_archive")
    return path


def validate_epub(path: Path) -> None:
    """Reject malformed EPUBs and archives with unsafe member paths or references."""
    try:
        with zipfile.ZipFile(path) as archive:
            members = archive.infolist()
            if len(members) > MAX_EPUB_MEMBERS:
                raise ArtifactValidationError("archive_too_large")
            names: set[str] = set()
            uncompressed_size = 0
            for member in members:
                _safe_zip_name(member.filename)
                if stat.S_ISLNK(member.external_attr >> 16):
                    raise ArtifactValidationError("unsafe_archive")
                uncompressed_size += member.file_size
                if uncompressed_size > MAX_EPUB_UNCOMPRESSED_BYTES:
                    raise ArtifactValidationError("archive_too_large")
                names.add(member.filename)
            if "META-INF/container.xml" not in names:
                raise ArtifactValidationError("missing_container")
            container = DefusedElementTree.fromstring(archive.read("META-INF/container.xml"))
            rootfiles = container.findall(".//{*}rootfile")
            if len(rootfiles) != 1:
                raise ArtifactValidationError("invalid_container")
            opf_name = rootfiles[0].get("full-path")
            if not opf_name or opf_name not in names:
                raise ArtifactValidationError("missing_package")
            package = DefusedElementTree.fromstring(archive.read(opf_name))
            manifest = package.find("{*}manifest")
            spine = package.find("{*}spine")
            if manifest is None or spine is None:
                raise ArtifactValidationError("invalid_package")
            opf_parent = PurePosixPath(opf_name).parent
            manifest_items: dict[str, str] = {}
            has_navigation = False
            for item in manifest.findall("{*}item"):
                item_id, href = item.get("id"), item.get("href")
                if not item_id or not href:
                    raise ArtifactValidationError("invalid_manifest")
                target = str(opf_parent / _safe_zip_name(href))
                if target not in names:
                    raise ArtifactValidationError("invalid_reference")
                manifest_items[item_id] = target
                has_navigation |= "nav" in (item.get("properties") or "").split()
            spine_refs = [itemref.get("idref") for itemref in spine.findall("{*}itemref")]
            if not spine_refs or any(ref not in manifest_items for ref in spine_refs):
                raise ArtifactValidationError("invalid_spine")
            if not has_navigation and spine.get("toc") not in manifest_items:
                raise ArtifactValidationError("missing_navigation")
    except (DefusedXmlException, ElementTree.ParseError, zipfile.BadZipFile) as exc:
        raise ArtifactValidationError("invalid_epub") from exc


def _validate_output_size(output: Path) -> None:
    if not output.is_file() or output.stat().st_size > MAX_OUTPUT_BYTES:
        raise ArtifactValidationError("output_too_large")


def _limit_converter_resources() -> None:
    """Apply child-only limits before Calibre starts."""
    resource.setrlimit(
        resource.RLIMIT_CPU, (CONVERSION_TIMEOUT_SECONDS, CONVERSION_TIMEOUT_SECONDS)
    )
    resource.setrlimit(resource.RLIMIT_AS, (MAX_CONVERTER_MEMORY_BYTES, MAX_CONVERTER_MEMORY_BYTES))
    resource.setrlimit(resource.RLIMIT_FSIZE, (MAX_OUTPUT_BYTES, MAX_OUTPUT_BYTES))


def _format_converter_output(output: str | bytes | None) -> str:
    """Return bounded converter output suitable for a single log record."""
    if output is None:
        return "<none>"
    if isinstance(output, bytes):
        output = output.decode("utf-8", errors="replace")
    if len(output) <= MAX_CONVERTER_LOG_CHARS:
        return output
    return output[:MAX_CONVERTER_LOG_CHARS] + "... [truncated]"


class DerivedArtifactService:
    """Build and retain private derived EPUBs for finalized AZW3 Files."""

    def __init__(self, db_path: str, *, executor: ThreadPoolExecutor | None = None) -> None:
        self._db_path = db_path
        self._executor = executor or ThreadPoolExecutor(
            max_workers=2, thread_name_prefix="epub-convert"
        )
        self._lock = threading.Lock()
        self._recover_interrupted_conversions()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self._db_path)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        return conn

    def _recover_interrupted_conversions(self) -> None:
        """Make work abandoned by a prior process eligible for an idempotent retry."""
        conn = self._connect()
        try:
            conn.execute(
                "UPDATE derived_artifacts SET status = 'interrupted', updated_at = ? "
                "WHERE status = 'converting'",
                (now_utc_iso(),),
            )
            conn.commit()
        finally:
            conn.close()

    def schedule_history_ids(self, history_ids: list[int]) -> None:
        """Submit completed AZW3 File conversions without blocking finalization."""
        for history_id in history_ids:
            self._executor.submit(self.convert_history_id, history_id)

    def _source_file(self, history_id: int) -> SourceFile | None:
        conn = self._connect()
        try:
            row = conn.execute(
                """SELECT id, book_id, download_path FROM download_history
                WHERE id = ? AND final_status = 'complete' AND LOWER(format) = 'azw3'
                AND download_path IS NOT NULL""",
                (history_id,),
            ).fetchone()
            if row is None:
                return None
            return SourceFile(int(row["id"]), row["book_id"], Path(row["download_path"]))
        finally:
            conn.close()

    def _claim(self, source: SourceFile, source_hash: str) -> int | None:
        options = "{}"
        with self._lock:
            conn = self._connect()
            try:
                cursor = conn.execute(
                    """INSERT OR IGNORE INTO derived_artifacts (
                    source_history_id, book_id, source_hash, target_format, converter_version,
                    normalized_options, status, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)""",
                    (
                        source.history_id,
                        source.book_id,
                        source_hash,
                        TARGET_FORMAT,
                        CONVERTER_VERSION,
                        options,
                        now_utc_iso(),
                        now_utc_iso(),
                    ),
                )
                row = conn.execute(
                    """SELECT id, status FROM derived_artifacts WHERE source_history_id = ?
                    AND source_hash = ? AND target_format = ? AND converter_version = ?
                    AND normalized_options = ?""",
                    (source.history_id, source_hash, TARGET_FORMAT, CONVERTER_VERSION, options),
                ).fetchone()
                if row is None or row["status"] == "ready":
                    conn.commit()
                    return None
                cursor = conn.execute(
                    """UPDATE derived_artifacts SET status = 'converting', error_code = NULL,
                    validation_result = NULL, updated_at = ?, started_at = ?
                    WHERE id = ? AND status IN ('pending', 'failed', 'interrupted')""",
                    (now_utc_iso(), now_utc_iso(), row["id"]),
                )
                conn.commit()
                return int(row["id"]) if cursor.rowcount else None
            finally:
                conn.close()

    def _mark_failure(self, artifact_id: int, error_code: str) -> None:
        conn = self._connect()
        try:
            conn.execute(
                """UPDATE derived_artifacts SET status = 'failed', error_code = ?, updated_at = ?,
                completed_at = ? WHERE id = ?""",
                (error_code, now_utc_iso(), now_utc_iso(), artifact_id),
            )
            conn.commit()
        finally:
            conn.close()

    def _notify_failure(self, artifact_id: int, error_code: str) -> None:
        conn = self._connect()
        try:
            row = conn.execute(
                """SELECT b.title, b.author FROM derived_artifacts da
                   LEFT JOIN books b ON b.id = da.book_id WHERE da.id = ?""",
                (artifact_id,),
            ).fetchone()
        finally:
            conn.close()
        if row is None:
            return
        try:
            notify_admin(
                NotificationEvent.CONVERSION_FAILED,
                NotificationContext(
                    event=NotificationEvent.CONVERSION_FAILED,
                    title=str(row["title"] or "Unknown title"),
                    author=str(row["author"] or "Unknown author"),
                    error_message=error_code,
                ),
            )
        except (RuntimeError, TypeError, ValueError) as exc:
            logger.warning("Failed to notify admin of EPUB conversion failure: %s", exc)

    def convert_history_id(self, history_id: int) -> None:
        """Convert one source File. Failures only affect the private artifact record."""
        source = self._source_file(history_id)
        if source is None or not run_blocking_io(source.path.is_file):
            return
        try:
            source_hash = run_blocking_io(_sha256, source.path)
        except OSError:
            logger.warning("Could not hash AZW3 source history_id=%s", history_id, exc_info=True)
            return
        artifact_id = self._claim(source, source_hash)
        if artifact_id is None:
            return
        workspace: Path | None = None
        try:
            workspace = Path(
                run_blocking_io(tempfile.mkdtemp, prefix="derived-epub-", dir=str(TMP_DIR))
            )
            output = workspace / "output.epub"
            environment = {
                "PATH": "/usr/bin:/bin",
                "HOME": str(workspace),
                "QT_QPA_PLATFORM": "offscreen",
                "http_proxy": "",
                "https_proxy": "",
                "ALL_PROXY": "",
            }
            run_blocking_io(
                subprocess.run,
                [str(CONVERTER_PATH), str(source.path), str(output), "--epub-version=3"],
                check=True,
                timeout=CONVERSION_TIMEOUT_SECONDS,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                errors="replace",
                env=environment,
                cwd=str(workspace),
                preexec_fn=_limit_converter_resources,
            )
            _validate_output_size(output)
            validate_epub(output)
            destination = self._promote(output, source, source_hash)
            output_hash = run_blocking_io(_sha256, destination)
            conn = self._connect()
            try:
                cursor = conn.execute(
                    """UPDATE derived_artifacts SET status = 'ready', artifact_path = ?, output_size = ?,
                    output_hash = ?, validation_result = 'valid', error_code = NULL, updated_at = ?,
                    completed_at = ? WHERE id = ? AND status = 'converting'""",
                    (
                        str(destination),
                        destination.stat().st_size,
                        output_hash,
                        now_utc_iso(),
                        now_utc_iso(),
                        artifact_id,
                    ),
                )
                conn.commit()
            finally:
                conn.close()
            if cursor.rowcount == 0:
                # Source cleanup won the race; never leave a late promoted file behind.
                run_blocking_io(destination.unlink, missing_ok=True)
        except subprocess.TimeoutExpired as exc:
            logger.warning(
                "AZW3 conversion timed out for history_id=%s: stdout=%r stderr=%r",
                history_id,
                _format_converter_output(exc.stdout),
                _format_converter_output(exc.stderr),
                exc_info=True,
            )
            self._mark_failure(artifact_id, "timeout")
            self._notify_failure(artifact_id, "timeout")
        except subprocess.CalledProcessError as exc:
            logger.warning(
                "AZW3 conversion failed for history_id=%s: returncode=%s stdout=%r stderr=%r",
                history_id,
                exc.returncode,
                _format_converter_output(exc.stdout),
                _format_converter_output(exc.stderr),
                exc_info=True,
            )
            self._mark_failure(artifact_id, "converter_failed")
            self._notify_failure(artifact_id, "converter_failed")
        except ArtifactValidationError as exc:
            logger.warning(
                "AZW3 conversion validation failed for history_id=%s: %s", history_id, exc
            )
            self._mark_failure(artifact_id, str(exc))
            self._notify_failure(artifact_id, str(exc))
        except OSError, RuntimeError:
            logger.warning("AZW3 conversion failed for history_id=%s", history_id, exc_info=True)
            self._mark_failure(artifact_id, "conversion_failed")
            self._notify_failure(artifact_id, "conversion_failed")
        finally:
            if workspace is not None:
                run_blocking_io(shutil.rmtree, workspace, ignore_errors=True)

    @staticmethod
    def _promote(output: Path, source: SourceFile, source_hash: str) -> Path:
        parent = source.path.parent.resolve()
        base = source.path.stem
        for length in range(8, len(source_hash) + 1, 4):
            destination = (
                parent / f"{base}.__shelfmark_azw3_{source.history_id}_{source_hash[:length]}.epub"
            )
            if destination.parent.resolve() != parent:
                raise RuntimeError("unsafe_artifact_destination")
            fd, temporary = tempfile.mkstemp(
                prefix=".shelfmark-derived-", suffix=".tmp", dir=parent
            )
            os.close(fd)
            temporary_path = Path(temporary)
            try:
                shutil.copyfile(output, temporary_path)
                try:
                    os.link(temporary_path, destination)
                except FileExistsError:
                    continue
                return destination
            finally:
                temporary_path.unlink(missing_ok=True)
        raise RuntimeError("artifact_name_collision")

    def cleanup_sources(self, history_ids: list[int]) -> None:
        """Make source-derived artifacts unavailable, then remove their files."""
        if not history_ids:
            return
        conn = self._connect()
        try:
            rows = conn.execute(
                "SELECT id, artifact_path FROM derived_artifacts WHERE source_history_id IN "
                "(SELECT value FROM json_each(?)) AND status != 'deleted'",
                (json.dumps(history_ids),),
            ).fetchall()
            conn.execute(
                "UPDATE derived_artifacts SET status = 'deleting', updated_at = ? WHERE source_history_id IN "
                "(SELECT value FROM json_each(?))",
                (now_utc_iso(), json.dumps(history_ids)),
            )
            conn.commit()
        finally:
            conn.close()
        for row in rows:
            error: str | None = None
            path = Path(row["artifact_path"]) if row["artifact_path"] else None
            try:
                if path is not None:
                    run_blocking_io(path.unlink, missing_ok=True)
            except OSError:
                logger.warning("Could not remove derived artifact id=%s", row["id"], exc_info=True)
                error = "filesystem_cleanup_failed"
            conn = self._connect()
            try:
                conn.execute(
                    "UPDATE derived_artifacts SET status = ?, artifact_path = ?, cleanup_error = ?, "
                    "updated_at = ? WHERE id = ?",
                    (
                        "cleanup_failed" if error else "deleted",
                        str(path) if error and path is not None else None,
                        error,
                        now_utc_iso(),
                        row["id"],
                    ),
                )
                conn.commit()
            finally:
                conn.close()
