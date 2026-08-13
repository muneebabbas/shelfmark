"""Trusted administrator ingestion of uploaded Book files."""

from __future__ import annotations

import shutil
import tempfile
import uuid
from pathlib import Path
from typing import TYPE_CHECKING, Any

from shelfmark.core.logger import setup_logger
from shelfmark.core.request_helpers import emit_ws_event
from shelfmark.download.postprocess.transfer import transfer_selected_source_members

if TYPE_CHECKING:
    from collections.abc import Callable, Iterable

    from werkzeug.datastructures import FileStorage

    from shelfmark.core.download_history_service import DownloadHistoryService
    from shelfmark.core.import_activity_service import ImportActivityService
    from shelfmark.core.library_service import LibraryService

logger = setup_logger(__name__)


class ManualImportError(ValueError):
    """A safe validation error suitable for an API response."""

    @property
    def public_message(self) -> str:
        """Return the fixed, route-safe validation message."""
        return self.args[0] if self.args and isinstance(self.args[0], str) else "Invalid upload"


class ManualImportService:
    """Stage, persist, and asynchronously finalize one manual Book release."""

    def __init__(
        self,
        *,
        imports: ImportActivityService,
        history: DownloadHistoryService,
        library: LibraryService,
        storage_root: Path,
        tmp_root: Path,
        enabled_formats: Callable[[], set[str]],
        limits: Callable[[], tuple[int, int]],
        start_background: Callable[..., Any],
        ws_manager: object,
        emit_availability: Callable[[int, str], None],
    ) -> None:
        self._imports = imports
        self._history = history
        self._library = library
        self._storage_root = storage_root
        self._tmp_root = tmp_root
        self._enabled_formats = enabled_formats
        self._limits = limits
        self._start_background = start_background
        self._ws_manager = ws_manager
        self._emit_availability = emit_availability

    def capability(self) -> dict[str, Any]:
        max_total_bytes, max_file_count = self._limits()
        return {
            "enabled_formats": sorted(self._enabled_formats()),
            "max_total_bytes": max_total_bytes,
            "max_file_count": max_file_count,
        }

    def accept(
        self, *, book_id: int, actor_id: int, actor_username: str | None, files: Iterable[FileStorage]
    ) -> dict[str, Any]:
        """Stream a complete multipart submission, then schedule its import."""
        uploads = list(files)
        max_total_bytes, max_file_count = self._limits()
        if not uploads:
            raise ManualImportError("Select one or more files")
        if len(uploads) > max_file_count:
            raise ManualImportError("Too many files")
        self._tmp_root.mkdir(parents=True, exist_ok=True)
        staging_dir = Path(tempfile.mkdtemp(prefix="manual-import-", dir=self._tmp_root))
        staged: list[tuple[str, str, int, Path]] = []
        try:
            total_bytes = 0
            originals: set[str] = set()
            sanitized: set[str] = set()
            formats = self._enabled_formats()
            for index, upload in enumerate(uploads):
                original = Path(upload.filename or "").name
                safe_name = self._safe_basename(original)
                file_format = Path(safe_name).suffix.lstrip(".").lower()
                self._validate_format(file_format, formats)
                original_key = original.casefold()
                safe_key = safe_name.casefold()
                self._validate_unique_name(original_key, safe_key, originals, sanitized)
                originals.add(original_key)
                sanitized.add(safe_key)
                staged_path = staging_dir / f"{index:04d}"
                size = self._stage_upload(
                    upload=upload,
                    destination=staged_path,
                    maximum_bytes=max_total_bytes - total_bytes,
                )
                total_bytes += size
                staged.append((original, safe_name, size, staged_path))

            task_id = f"manual-{uuid.uuid4()}"
            activity = self._imports.accept_book_targeted_release(
                source_key=f"manual:{uuid.uuid4()}",
                source="manual",
                source_metadata={"file_count": len(staged), "staging_dir": str(staging_dir)},
                task_id=task_id,
                book_id=book_id,
                selected_by_user_id=actor_id if actor_id > 0 else None,
            )
            members = [
                self._imports.record_source_member(
                    source_release_id=activity["source_release_id"],
                    relative_path=safe_name,
                    size=size,
                    file_format=fmt,
                    discovery_status="uploaded",
                )
                for _, safe_name, size, _ in staged
                for fmt in [Path(safe_name).suffix.lstrip(".").lower()]
            ]
            activity = self._imports.plan_import(
                activity_id=activity["id"],
                storage_root=self._storage_root,
                selections=[{"source_member_id": member["id"], "evidence": {"match": "manual"}} for member in members],
            )
            self._history.record_download(
                task_id=task_id,
                user_id=actor_id,
                username=actor_username,
                request_id=None,
                source="manual",
                source_display_name="Manual upload",
                title=str(activity["book_snapshot"].get("title") or "Unknown title"),
                author=activity["book_snapshot"].get("author"),
                file_format=None,
                size=None,
                preview=None,
                content_type="ebook",
                origin="book",
                book_id=book_id,
                import_activity_id=activity["id"],
                retry_payload={"can_retry_without_staged_source": False},
            )
        except Exception:
            shutil.rmtree(staging_dir, ignore_errors=True)
            raise
        self._emit(activity, actor_id, "importing", len(staged))
        self._start_background(self._run, activity, actor_id, staged)
        return self.status(activity_id=int(activity["id"]), actor_id=actor_id) or {}

    def status(self, *, activity_id: int, actor_id: int) -> dict[str, Any] | None:
        activity = (
            self._imports.get_by_id(activity_id)
            if actor_id == 0
            else self._imports.get_by_id_for_user(activity_id=activity_id, user_id=actor_id)
        )
        if activity is None or activity["source_release"]["source"] != "manual":
            return None
        state = activity["state"]
        return {
            "activity_id": activity["id"],
            "task_id": activity["task_id"],
            "book_id": activity["book_id"],
            "state": "completed" if state == "completed" else "failed" if state == "failed" else "importing",
            "file_count": len(activity["selections"]),
            **({"message": "Manual import failed"} if state == "failed" else {}),
        }

    def reconcile_interrupted(self) -> None:
        """Fail in-progress manual imports after restart; v1 never resumes them."""
        for activity in self._imports.list_importing_manual():
            self._cleanup_activity(activity)
            try:
                self._history.finalize_download_files(
                    task_id=activity["task_id"], final_status="error", status_message="Manual import interrupted"
                )
                self._imports.fail(activity_id=activity["id"], error_context={"message": "interrupted"})
            except (OSError, RuntimeError, TypeError, ValueError) as exc:
                logger.warning("Failed to reconcile manual import %s: %s", activity["id"], exc)

    @staticmethod
    def _safe_basename(value: str) -> str:
        from shelfmark.core.naming import sanitize_filename

        if not value or value in {".", ".."} or "/" in value or "\\" in value:
            raise ManualImportError("One or more filenames are invalid")
        sanitized = sanitize_filename(value)
        if not sanitized or sanitized in {".", ".."}:
            raise ManualImportError("One or more filenames are invalid")
        return sanitized

    @staticmethod
    def _validate_format(file_format: str, formats: set[str]) -> None:
        if not file_format or file_format not in formats:
            raise ManualImportError("One or more files use an unsupported format")

    @staticmethod
    def _validate_unique_name(
        original: str, sanitized: str, originals: set[str], sanitized_names: set[str]
    ) -> None:
        if original in originals or sanitized in sanitized_names:
            raise ManualImportError("Uploaded filenames must be unique")

    @staticmethod
    def _validate_total_size(total_bytes: int, maximum: int) -> None:
        if total_bytes > maximum:
            raise ManualImportError("Total upload size exceeds the configured limit")

    @staticmethod
    def _stage_upload(*, upload: FileStorage, destination: Path, maximum_bytes: int) -> int:
        """Stream an upload to staging without writing bytes beyond the configured limit."""
        written = 0
        with destination.open("xb") as staged:
            while chunk := upload.stream.read(1024 * 1024):
                written += len(chunk)
                if written > maximum_bytes:
                    raise ManualImportError("Total upload size exceeds the configured limit")
                staged.write(chunk)
        return written

    @staticmethod
    def _require_transfer_success(error: str | None) -> None:
        if error:
            raise RuntimeError(error)

    def _run(self, activity: dict[str, Any], actor_id: int, staged: list[tuple[str, str, int, Path]]) -> None:
        try:
            paths, error, _ = transfer_selected_source_members(
                [(path, Path(selection["planned_output_path"])) for (_, _, _, path), selection in zip(staged, activity["selections"], strict=True)],
                use_hardlink=False,
                exact_copy=True,
            )
            self._require_transfer_success(error)
            self._history.finalize_download_files(
                task_id=activity["task_id"],
                final_status="complete",
                file_rows=[
                    {"download_path": str(path), "format": Path(name).suffix.lstrip(".").lower(), "size": str(size)}
                    for (_, name, size, _), path in zip(staged, paths, strict=True)
                ],
            )
            self._imports.complete(activity_id=activity["id"])
            self._cleanup_staging(activity)
            self._emit(activity, actor_id, "completed", len(staged))
            self._emit_availability(int(activity["book_id"]), str(activity["task_id"]))
        except (OSError, RuntimeError, TypeError, ValueError) as exc:
            logger.warning("Manual import %s failed: %s", activity["id"], exc)
            self._cleanup_activity(activity)
            try:
                self._history.finalize_download_files(
                    task_id=activity["task_id"], final_status="error", status_message="Manual import failed"
                )
                self._imports.fail(activity_id=activity["id"], error_context={"message": "import failed"})
            except (OSError, RuntimeError, TypeError, ValueError) as cleanup_exc:
                logger.warning("Manual import %s cleanup failed: %s", activity["id"], cleanup_exc)
            self._emit(activity, actor_id, "failed", len(staged), message="Manual import failed")

    def _cleanup_activity(self, activity: dict[str, Any]) -> None:
        for selection in activity["selections"]:
            Path(selection["planned_output_path"]).unlink(missing_ok=True)
        self._cleanup_staging(activity)

    @staticmethod
    def _cleanup_staging(activity: dict[str, Any]) -> None:
        staging_dir = (activity.get("source_release") or {}).get("metadata", {}).get("staging_dir")
        if isinstance(staging_dir, str):
            shutil.rmtree(staging_dir, ignore_errors=True)

    def _emit(self, activity: dict[str, Any], actor_id: int, state: str, file_count: int, *, message: str | None = None) -> None:
        payload: dict[str, Any] = {"activity_id": activity["id"], "task_id": activity["task_id"], "book_id": activity["book_id"], "state": state, "file_count": file_count}
        if message:
            payload["message"] = message
        emit_ws_event(self._ws_manager, event_name="manual_import_update", payload=payload, room=f"user_{actor_id}")
