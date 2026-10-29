"""A Python host for the facade's run, snapshot and screenshot tools.

It sends the bundle's sources to `Stagehand.experimental_batch` and does what the
TypeScript `StagehandFacadeTools` does with the results. The conformance cases in
`packages/integrations/core/conformance` pin that behavior for both hosts.
"""

from __future__ import annotations

import asyncio
import base64
import contextlib
import errno
import json
import math
import os
import re
import secrets
import stat
from collections.abc import Awaitable, Callable, Mapping, Sequence
from dataclasses import dataclass
from functools import cache
from typing import TYPE_CHECKING, Any, Literal, TypeGuard, TypeVar, cast

from jsonschema import Draft202012Validator
from jsonschema.exceptions import best_match
from jsonschema.protocols import Validator
from stagehand.rpc_client import RPCError

from ._syntax import check_run_syntax
from .bundle import _bundle, contract_error, facade_tools

if TYPE_CHECKING:
    from stagehand import Page, Stagehand

T = TypeVar("T")

RUN_BATCH_TIMEOUT_MS = 60_000
"""Executor deadline of a run batch, as in the TypeScript facade."""
PAGE_CAPTURE_DEADLINE_S = 120.0
"""snapshot/screenshot RPCs have no executor-side deadline; calls are serialized, so
one that never answers must release the queue at a bounded deadline."""
SCREENSHOT_ARTIFACT_NO_FOLLOW_ERROR = (
    "Screenshot artifacts cannot be written safely on this platform: it has no O_NOFOLLOW."
)
"""Python-only: refuses to write on platforms without O_NOFOLLOW (Windows); the TypeScript
host relies on the target lstat, O_EXCL and rename instead."""
DEFAULT_ARTIFACT_DIRECTORY = "stagehand-artifacts"
"""Directory under the current working directory that screenshot artifacts are written to
when a host sets no artifact root."""

_ARTIFACT_EXTENSION = re.compile(r"\.(?:png|jpe?g)\Z", re.I | re.A)
# NAME_MAX on Linux and macOS, in bytes.
_MAX_NAME_BYTES = 255
# Either signature is accepted under any image extension, as Playwright's `type` wins
# over the path.
_IMAGE_SIGNATURES = (b"\x89PNG\r\n\x1a\n", b"\xff\xd8\xff")
_ERROR_NAME = re.compile(r"[A-Za-z][A-Za-z0-9]*Error")
# Padded RFC 4648 base64, as btoa writes it (see isCanonicalBase64 in tools.ts).
_CANONICAL_BASE64 = re.compile(r"[A-Za-z0-9+/]*={0,2}")
# sanitizeErrorMessage in src/harness/redact.ts. JavaScript regexes without the
# `u` flag are ASCII for \b, \w and case folding, but \s is Unicode whitespace.
_JS_SPACE = "\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff"
_REDACTIONS = [
    (
        re.compile(
            rf"([?&](?:signingKey|apiKey|api_key|token|key)=)[^&{_JS_SPACE}\"']+", re.I | re.A
        ),
        r"\1[redacted]",
    ),
    (re.compile(r"\b(sk-[A-Za-z0-9_-]{6})[A-Za-z0-9_-]+", re.A), r"\1[redacted]"),
    (re.compile(r"\b(bb_(?:live|test)_[A-Za-z0-9]{4})[A-Za-z0-9_-]+", re.A), r"\1[redacted]"),
    (re.compile(r"\bAIza[0-9A-Za-z_-]{30,}", re.A), "AIza[redacted]"),
    (
        re.compile(rf"\b(Bearer[{_JS_SPACE}]+)[A-Za-z0-9._~+/=-]{{8,}}", re.I | re.A),
        r"\1[redacted]",
    ),
]


def sanitize_error_message(message: str) -> str:
    for pattern, replacement in _REDACTIONS:
        message = pattern.sub(replacement, message)
    return message


class StagehandFacadeInputError(Exception):
    """An ordinary tool error the agent can act on."""

    def __init__(self, message: str) -> None:
        super().__init__(sanitize_error_message(message))


class StagehandFacadeExecutionError(Exception):
    """The error run code threw inside the browser, with its JavaScript name and stack."""

    def __init__(self, name: str, message: str, stack: str | None = None) -> None:
        super().__init__(sanitize_error_message(message))
        name = sanitize_error_message(name)
        self.name = name if _ERROR_NAME.fullmatch(name) else "Error"
        self.stack = None if stack is None else sanitize_error_message(stack)


class StagehandFacadeCleanupError(Exception):
    def __init__(self) -> None:
        super().__init__("Failed to close the Stagehand browser session.")


@dataclass
class _Snapshot:
    url: str
    xpath_by_id: dict[str, str]


class StagehandFacadeTools:
    """The facade's tools over one Stagehand. Calls run one at a time, in order.

    Screenshots run code saves with a ``path`` are written under ``artifact_root``
    (default: ``DEFAULT_ARTIFACT_DIRECTORY`` under the current directory) and must
    stay within it. Only ``.png``, ``.jpg`` and ``.jpeg`` files holding PNG or JPEG
    bytes are written, and an existing file is replaced rather than written through.
    Run code can replace any such image under the root, so point it at a dedicated
    directory. The default root must not be a symlink; a configured one may be. New
    files are owner-only; a replaced file keeps its permissions. ``on_close_requested``
    replaces the default cleanup (closing the Stagehand, then its browser) when run
    code calls ``browser.close()``.

    ``quiet_wait`` (experimental, off by default) makes ``page.waitForTimeout(ms)`` in
    run code return once the page is quiet, never later than ms; see
    ``contract.runOptions.quietWait`` in the bundle.
    """

    def __init__(
        self,
        stagehand: Stagehand,
        *,
        artifact_root: str | os.PathLike[str] | None = None,
        on_close_requested: Callable[[], Awaitable[None]] | None = None,
        quiet_wait: bool | None = None,
    ) -> None:
        self._stagehand = stagehand
        self._artifact_root = artifact_root
        self._on_close_requested = on_close_requested
        if quiet_wait is None:
            quiet_wait = _bundle()["contract"]["runOptions"]["quietWait"]["default"]
        # Options go in the run input only when on, so the default input stays `{}`.
        self._run_input: dict[str, object] = {"quietWait": True} if quiet_wait else {}
        self._snapshots: dict[str, _Snapshot] = {}
        self._lock = asyncio.Lock()
        self._closed = False
        self._close_task: asyncio.Task[None] | None = None

    async def close(self) -> None:
        self._closed = True
        if self._close_task is None:
            self._close_task = asyncio.ensure_future(self._close_now())
        await self._close_task

    async def run(
        self, *, code: str | None = None, actions: Sequence[Mapping[str, Any]] | None = None
    ) -> object:
        """Run Playwright-style ``code``, or ``actions`` by snapshot ID. Pass exactly one.

        Code returns the value it returned; actions return ``{"completed", "url"}``.
        """
        if code is not None and actions is None:
            _validate_run_input({"code": code})
            return await self._serialized(lambda: self._run_code(code))
        if actions is not None and code is None:
            listed = list(actions)
            _validate_run_input({"actions": listed})
            return await self._serialized(lambda: self._run_actions(listed))
        raise StagehandFacadeInputError("run requires exactly one of code or actions")

    async def snapshot(self, *, include_iframes: bool = True) -> str:
        return await self._serialized(lambda: self._snapshot_now(include_iframes))

    async def screenshot(
        self,
        *,
        full_page: bool | None = None,
        type: Literal["png", "jpeg"] = "png",
        quality: float | None = None,
    ) -> dict[str, str]:
        """The active page as ``{"data": base64, "mimeType": "image/png" | "image/jpeg"}``."""
        return await self._serialized(lambda: self._screenshot_now(full_page, type, quality))

    async def _serialized(self, operation: Callable[[], Awaitable[T]]) -> T:
        async with self._lock:
            if self._closed:
                raise StagehandFacadeInputError(contract_error("FACADE_BROWSER_CLOSED_ERROR"))
            return await operation()

    async def _snapshot_now(self, include_iframes: bool) -> str:
        page = await self._active_page()
        # A failed capture invalidates the previous snapshot's IDs too.
        self._snapshots.pop(page.page_id, None)

        async def capture() -> tuple[str, dict[str, str], str]:
            # Disable the SDK's own 20s timeout so the capture deadline owns the wait.
            snapshot = await page.snapshot(include_iframes=include_iframes, timeout=0.0)
            return snapshot.formatted_tree, snapshot.xpath_map, await page.url()

        tree, xpath_map, url = await _with_deadline(capture(), "page.snapshot")
        self._snapshots[page.page_id] = _Snapshot(url, dict(xpath_map))
        return tree

    async def _screenshot_now(
        self, full_page: bool | None, type: Literal["png", "jpeg"], quality: float | None
    ) -> dict[str, str]:
        page = await self._active_page()
        # CDP only accepts quality for jpeg, and only as an integer (rounded like Math.round).
        rounded = math.floor(quality + 0.5) if type == "jpeg" and quality is not None else None
        data = await _with_deadline(
            page.screenshot(type=type, full_page=full_page, quality=rounded), "page.screenshot"
        )
        mime_type = "image/jpeg" if type == "jpeg" else "image/png"
        return {"data": base64.b64encode(data).decode("ascii"), "mimeType": mime_type}

    async def _run_actions(self, actions: list[Mapping[str, Any]]) -> dict[str, Any]:
        page = await self._active_page()
        snapshot = self._snapshots.get(page.page_id)
        if snapshot is None:
            raise StagehandFacadeInputError(contract_error("NO_HYDRATED_SNAPSHOT_ERROR"))
        if await page.url() != snapshot.url:
            del self._snapshots[page.page_id]
            raise StagehandFacadeInputError(contract_error("NAVIGATED_SNAPSHOT_ERROR"))
        # Earlier actions may already have run when one fails; never replay the batch.
        result = await self._stagehand.experimental_batch(
            _bundle()["sources"]["actionRunner"],
            {"actions": actions, "xpathById": snapshot.xpath_by_id},
            timeout=RUN_BATCH_TIMEOUT_MS,
            page=page,
        )
        result = result if isinstance(result, dict) else {}
        if isinstance(result.get("staleId"), str):
            raise StagehandFacadeInputError(
                contract_error("STALE_SNAPSHOT_ID_ERROR", id=result["staleId"])
            )
        return {"completed": result.get("completed", len(actions)), "url": await page.url()}

    async def _run_code(self, code: str) -> object:
        check_run_syntax(code)
        sources = _bundle()["sources"]
        source = sources["runPrelude"] + code + sources["runEpilogue"]
        page = await self._active_page()
        envelope = await self._run_batch(source, page)
        # Agent code builds this result, so nothing in it is acted on unless it has
        # the envelope's shape.
        if not _is_run_envelope(envelope):
            raise StagehandFacadeInputError(contract_error("RUN_RESULT_MALFORMED_ERROR"))
        run_error: Exception | None = None
        try:
            self._write_artifacts(envelope["artifacts"])
            execution_error = envelope.get("executionError")
            if execution_error is not None:
                raise StagehandFacadeExecutionError(
                    execution_error["name"],
                    execution_error["message"],
                    execution_error.get("stack"),
                )
            limit = _bundle()["contract"]["limits"]["maxValueBytes"]
            if _json_value_bytes(envelope.get("value")) > limit:
                raise StagehandFacadeInputError(contract_error("RUN_VALUE_SIZE_ERROR"))
        except Exception as error:
            run_error = error
        # Close only once the batch finished, even when the code or writing failed.
        if envelope["closeRequested"]:
            try:
                await self.close()
            except Exception as close_error:
                if run_error is not None:
                    raise ExceptionGroup(
                        "Run failed and cleanup also failed.", [run_error, close_error]
                    ) from None
                raise
        if run_error is not None:
            raise run_error
        return envelope.get("value")

    async def _run_batch(self, source: str, page: Page) -> object:
        """When the active page vanished before the batch started (the previous code
        closed its tab), retry once on the new active page; no code has run yet."""
        try:
            return await self._stagehand.experimental_batch(
                source, dict(self._run_input), timeout=RUN_BATCH_TIMEOUT_MS, page=page
            )
        except Exception as error:
            if not re.search(r"callback batch page was not found", str(error), re.I):
                raise
        return await self._stagehand.experimental_batch(
            source,
            dict(self._run_input),
            timeout=RUN_BATCH_TIMEOUT_MS,
            page=await self._active_page(),
        )

    def _write_artifacts(self, artifacts: list[dict[str, str]]) -> None:
        if not artifacts:
            return
        limits = _bundle()["contract"]["limits"]
        # Check every cap before the first write so an oversized run saves nothing.
        if len(artifacts) > limits["maxArtifacts"]:
            raise StagehandFacadeInputError(contract_error("SCREENSHOT_ARTIFACT_COUNT_ERROR"))
        # Sizes come from the base64 length (_is_run_envelope already required
        # canonical padding), so no artifact is decoded until all of them fit.
        total = 0
        for artifact in artifacts:
            size = _decoded_base64_length(artifact["base64"])
            if size > limits["maxArtifactBytes"]:
                raise StagehandFacadeInputError(contract_error("SCREENSHOT_ARTIFACT_SIZE_ERROR"))
            total += size
            if total > limits["maxTotalArtifactBytes"]:
                raise StagehandFacadeInputError(
                    contract_error("SCREENSHOT_ARTIFACT_TOTAL_SIZE_ERROR")
                )
        decoded = [
            (artifact["path"], base64.b64decode(artifact["base64"], validate=True))
            for artifact in artifacts
        ]
        try:
            self._write_artifact_files(decoded)
        except OSError as error:
            # Filesystem errors carry host paths; the agent gets only their code.
            code = errno.errorcode.get(error.errno or 0, type(error).__name__)
            raise StagehandFacadeInputError(
                contract_error("SCREENSHOT_ARTIFACT_WRITE_ERROR", cause=code)
            ) from None

    def _write_artifact_files(self, artifacts: list[tuple[str, bytes]]) -> None:
        configured_root = os.path.abspath(
            self._artifact_root or os.path.join(os.getcwd(), DEFAULT_ARTIFACT_DIRECTORY)
        )
        # A configured root may be a symlink; the default one, found in whatever
        # directory the host runs in, may not.
        if not self._artifact_root and os.path.islink(configured_root):
            raise StagehandFacadeInputError(contract_error("SCREENSHOT_ARTIFACT_SYMLINK_ERROR"))
        os.makedirs(configured_root, exist_ok=True)
        root = os.path.realpath(configured_root)
        for path, data in artifacts:
            target = os.path.normpath(os.path.join(configured_root, path))
            try:
                relative = os.path.relpath(target, configured_root)
            except ValueError:  # another drive on Windows
                relative = target
            if (
                relative in (".", "..")
                or relative.startswith(f"..{os.sep}")
                or os.path.isabs(relative)
            ):
                raise StagehandFacadeInputError(contract_error("SCREENSHOT_ARTIFACT_PATH_ERROR"))
            *parents, name = relative.split(os.sep)
            if any(
                "\0" in component or (os.name == "nt" and ":" in component)
                for component in (*parents, name)
            ):
                raise StagehandFacadeInputError(contract_error("SCREENSHOT_ARTIFACT_PATH_ERROR"))
            if not _ARTIFACT_EXTENSION.search(name):
                raise StagehandFacadeInputError(contract_error("SCREENSHOT_ARTIFACT_TYPE_ERROR"))
            if not data.startswith(_IMAGE_SIGNATURES):
                raise StagehandFacadeInputError(contract_error("SCREENSHOT_ARTIFACT_CONTENT_ERROR"))
            # Checked up front so an overlong name creates no directories.
            if any(len(os.fsencode(component)) > _MAX_NAME_BYTES for component in (*parents, name)):
                raise StagehandFacadeInputError(
                    contract_error("SCREENSHOT_ARTIFACT_WRITE_ERROR", cause="ENAMETOOLONG")
                )
            # Reject symlinks before creating nested directories. An existing file is
            # replaced by renaming a new file over it, never written through, so other
            # links to it keep their contents.
            directory = root
            for component in parents:
                directory = os.path.join(directory, component)
                with contextlib.suppress(FileExistsError):
                    os.mkdir(directory)
                mode = os.lstat(directory).st_mode
                if stat.S_ISLNK(mode):
                    raise StagehandFacadeInputError(
                        contract_error("SCREENSHOT_ARTIFACT_SYMLINK_ERROR")
                    )
                if not stat.S_ISDIR(mode):
                    raise StagehandFacadeInputError(
                        contract_error("SCREENSHOT_ARTIFACT_NOT_DIRECTORY_ERROR")
                    )
            target = os.path.join(directory, name)
            try:
                existing: os.stat_result | None = os.lstat(target)
            except FileNotFoundError:
                existing = None
            if existing is not None:
                if stat.S_ISLNK(existing.st_mode):
                    raise StagehandFacadeInputError(
                        contract_error("SCREENSHOT_ARTIFACT_FILE_SYMLINK_ERROR")
                    )
                if not stat.S_ISREG(existing.st_mode):
                    raise StagehandFacadeInputError(
                        contract_error("SCREENSHOT_ARTIFACT_NOT_FILE_ERROR")
                    )
            no_follow = getattr(os, "O_NOFOLLOW", None)
            if no_follow is None:
                # Without O_NOFOLLOW (Windows) artifact writes stay refused.
                raise StagehandFacadeInputError(SCREENSHOT_ARTIFACT_NO_FOLLOW_ERROR)
            temporary = os.path.join(directory, f".stagehand-{secrets.token_hex(8)}.tmp")
            flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | no_follow
            descriptor = os.open(temporary, flags, 0o600)
            try:
                with os.fdopen(descriptor, "wb") as file:
                    # A replaced file keeps its permissions; a new one is owner-only.
                    if existing is not None:
                        os.fchmod(file.fileno(), stat.S_IMODE(existing.st_mode) & 0o777)
                    file.write(data)
                os.replace(temporary, target)
            except BaseException:
                with contextlib.suppress(FileNotFoundError):
                    os.unlink(temporary)
                raise

    async def _active_page(self) -> Page:
        """The page the agent works on; a fresh blank page when its tab is gone.

        When another window has focus on a tab Stagehand does not manage, the agent
        keeps working on the newest tab Stagehand registered; nothing is reordered,
        since activating a tab does not move window focus.
        """
        context = self._stagehand.browser.context
        try:
            active = await context.active_page()
        except RPCError as error:
            marker = _bundle()["contract"]["sdkErrorMarkers"]["UNMANAGED_ACTIVE_PAGE_ERROR_MARKER"]
            if marker not in str(error):
                raise
            pages = await context.pages()
            return pages[-1] if pages else await context.new_page()
        if active is not None:
            return active
        pages = await context.pages()
        page = pages[0] if pages else await context.new_page()
        await context.set_active_page(page)
        return page

    async def _close_now(self) -> None:
        if self._on_close_requested is not None:
            try:
                await self._on_close_requested()
            except Exception:
                # Not chained: the callback's error can carry provider details.
                raise StagehandFacadeCleanupError() from None
            return
        failed = False
        for close in (self._stagehand.close, self._stagehand.browser.close):
            try:
                await close()
            except Exception:
                failed = True
        if failed:
            raise StagehandFacadeCleanupError()


def _decoded_base64_length(value: str) -> int:
    """Byte length a canonical padded base64 string decodes to."""
    padding = 2 if value.endswith("==") else 1 if value.endswith("=") else 0
    return len(value) // 4 * 3 - padding


def _json_value_bytes(value: object) -> int:
    """UTF-8 length of the value's compact JSON as JavaScript's JSON.stringify writes
    it: non-ASCII unescaped, but a lone surrogate written as a six-byte \\uXXXX escape."""
    text = json.dumps(value, separators=(",", ":"), ensure_ascii=False)
    # Pair up surrogates the string holds as two code units, then escape the rest.
    text = text.encode("utf-16", "surrogatepass").decode("utf-16", "surrogatepass")
    text = re.sub(r"[\ud800-\udfff]", lambda match: f"\\u{ord(match.group()):04x}", text)
    return len(text.encode("utf-8"))


async def _with_deadline(awaitable: Awaitable[T], operation: str) -> T:
    try:
        return await asyncio.wait_for(awaitable, PAGE_CAPTURE_DEADLINE_S)
    except TimeoutError:
        timeout_ms = round(PAGE_CAPTURE_DEADLINE_S * 1000)
        raise TimeoutError(f"{operation} received no response within {timeout_ms}ms") from None


@cache
def _run_input_validator() -> Validator:
    return Draft202012Validator(facade_tools()[0]["inputSchema"])


def _validate_run_input(arguments: dict[str, object]) -> None:
    """Checks run arguments against the run tool's input schema."""
    error = best_match(_run_input_validator().iter_errors(arguments))
    if error is not None:
        raise StagehandFacadeInputError(f"Invalid run input: {error.message}")
    # The advertised schema leaves out RefActionSchema's non-empty `id` and `key`
    # (src/facade/contract.ts), which the TypeScript host also enforces.
    for action in cast("list[dict[str, object]]", arguments.get("actions", [])):
        for field in ("id", "key"):
            if action.get(field) == "":
                raise StagehandFacadeInputError(f"Invalid run input: '{field}' must not be empty")


def _is_run_envelope(value: object) -> TypeGuard[dict[str, Any]]:
    if not isinstance(value, dict) or value.get("__stagehandPlaywrightCompat") is not True:
        return False
    runtime_ms = value.get("batchRuntimeMs")
    artifacts = value.get("artifacts")
    error = value.get("executionError")
    return (
        isinstance(value.get("closeRequested"), bool)
        and isinstance(runtime_ms, int | float)
        and not isinstance(runtime_ms, bool)
        and isinstance(value.get("telemetry"), dict)
        and isinstance(artifacts, list)
        and all(
            isinstance(artifact, dict)
            and isinstance(artifact.get("path"), str)
            and isinstance(artifact.get("base64"), str)
            and len(artifact["base64"]) % 4 == 0
            and _CANONICAL_BASE64.fullmatch(artifact["base64"]) is not None
            for artifact in artifacts
        )
        and (
            error is None
            or (
                isinstance(error, dict)
                and isinstance(error.get("name"), str)
                and isinstance(error.get("message"), str)
                and ("stack" not in error or isinstance(error["stack"], str))
            )
        )
    )
