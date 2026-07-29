from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from dataclasses import dataclass
from enum import StrEnum
from pathlib import Path
from typing import Protocol

from .browserbase_client import (
    BrowserbaseClient,
    BrowserbaseExtensionDeleteRequest,
    BrowserbaseExtensionResponse,
    BrowserbaseExtensionUploadRequest,
    BrowserbaseSessionCreateRequest,
    BrowserbaseSessionReleaseRequest,
    BrowserbaseSessionResponse,
)
from .client_models import BrowserbaseBrowserSource

_STAGEHAND_EXTENSION_ARCHIVE_NAME = "stagehand-extension.zip"


class BrowserbaseSessionErrorCode(StrEnum):
    MISSING_EXTENSION_ARCHIVE = "missing_extension_archive"
    EMPTY_EXTENSION_ARCHIVE = "empty_extension_archive"
    EMPTY_EXTENSION_ID = "empty_extension_id"
    EMPTY_SESSION_ID = "empty_session_id"
    CLEANUP_FAILED = "cleanup_failed"


class BrowserbaseSessionError(RuntimeError):
    def __init__(self, code: BrowserbaseSessionErrorCode, message: str) -> None:
        self.code = code
        super().__init__(message)


class BrowserbaseSessionCleanupError(BrowserbaseSessionError):
    def __init__(self, failed_operations: tuple[str, ...]) -> None:
        self.failed_operations = failed_operations
        super().__init__(
            BrowserbaseSessionErrorCode.CLEANUP_FAILED,
            "Browserbase session cleanup failed; resources may remain.",
        )


class _BrowserbaseSessionAPI(Protocol):
    async def upload_extension(
        self,
        request: BrowserbaseExtensionUploadRequest,
    ) -> BrowserbaseExtensionResponse: ...

    async def delete_extension(self, request: BrowserbaseExtensionDeleteRequest) -> None: ...

    async def create_session(
        self,
        request: BrowserbaseSessionCreateRequest,
    ) -> BrowserbaseSessionResponse: ...

    async def release_session(
        self,
        request: BrowserbaseSessionReleaseRequest,
    ) -> object: ...


BrowserbaseAPIFactory = Callable[[str], BrowserbaseClient]
ExtensionArchiveLoader = Callable[[], bytes]


@dataclass(frozen=True)
class BrowserbaseSession:
    session_id: str
    cdp_url: str
    close: Callable[[], Awaitable[None]]


class BrowserbaseSessionClient:
    def __init__(
        self,
        api_key: str,
        *,
        api: _BrowserbaseSessionAPI | None = None,
        api_factory: BrowserbaseAPIFactory = BrowserbaseClient,
        archive_loader: ExtensionArchiveLoader | None = None,
    ) -> None:
        self._api_key = api_key
        self._api = api
        self._api_factory = api_factory
        self._archive_loader = archive_loader or load_stagehand_extension_archive

    async def create_session(self, source: BrowserbaseBrowserSource) -> BrowserbaseSession:
        request_values = source.model_dump(
            mode="python",
            exclude={"type"},
            exclude_none=True,
        )
        request_values["user_metadata"] = {
            **(source.user_metadata or {}),
            "stagehand": "true",
            "stagehand_sdk_language": "python",
        }
        request = BrowserbaseSessionCreateRequest.model_validate(request_values)

        archive = self._archive_loader()
        if not archive:
            raise BrowserbaseSessionError(
                BrowserbaseSessionErrorCode.EMPTY_EXTENSION_ARCHIVE,
                "The bundled Stagehand extension archive is empty.",
            )

        async with self._open_api() as api:
            uploaded = await api.upload_extension(
                BrowserbaseExtensionUploadRequest(archive=archive)
            )
            extension_id = uploaded.id.strip()
            if not extension_id:
                raise BrowserbaseSessionError(
                    BrowserbaseSessionErrorCode.EMPTY_EXTENSION_ID,
                    "Browserbase extension upload returned an empty extension ID.",
                )

            try:
                session = await api.create_session(
                    request.model_copy(update={"extension_id": extension_id})
                )
            except BaseException:
                await _delete_extension_best_effort(api, extension_id)
                raise

            session_id = session.id.strip()
            cdp_url = str(session.connect_url).strip()
            if not session_id:
                await _cleanup_invalid_session(api, session_id, extension_id)
                raise BrowserbaseSessionError(
                    BrowserbaseSessionErrorCode.EMPTY_SESSION_ID,
                    "Browserbase session creation returned an empty session ID.",
                )

        resources = _BrowserbaseSessionResources(
            api_key=self._api_key,
            api=self._api,
            api_factory=self._api_factory,
            session_id=session_id,
            extension_id=extension_id,
        )
        return BrowserbaseSession(
            session_id=session_id,
            cdp_url=cdp_url,
            close=resources.close,
        )

    @asynccontextmanager
    async def _open_api(self) -> AsyncIterator[_BrowserbaseSessionAPI]:
        if self._api is not None:
            yield self._api
            return

        api = self._api_factory(self._api_key)
        try:
            yield api
        finally:
            await api.aclose()


class _BrowserbaseSessionResources:
    def __init__(
        self,
        *,
        api_key: str,
        api: _BrowserbaseSessionAPI | None,
        api_factory: BrowserbaseAPIFactory,
        session_id: str,
        extension_id: str,
    ) -> None:
        self._api_key = api_key
        self._api = api
        self._api_factory = api_factory
        self._session_id = session_id
        self._extension_id = extension_id
        self._session_released = False
        self._extension_deleted = False
        self._lock = asyncio.Lock()

    async def close(self) -> None:
        async with self._lock:
            if self._session_released and self._extension_deleted:
                return

            if self._api is not None:
                await self._close_with_api(self._api)
                return

            api = self._api_factory(self._api_key)
            try:
                await self._close_with_api(api)
            finally:
                await api.aclose()

    async def _close_with_api(self, api: _BrowserbaseSessionAPI) -> None:
        errors: list[tuple[str, BaseException]] = []
        if not self._session_released:
            try:
                await api.release_session(
                    BrowserbaseSessionReleaseRequest(session_id=self._session_id)
                )
                self._session_released = True
            except BaseException as error:
                errors.append(("release_session", error))

        if not self._extension_deleted:
            try:
                await api.delete_extension(
                    BrowserbaseExtensionDeleteRequest(extension_id=self._extension_id)
                )
                self._extension_deleted = True
            except BaseException as error:
                errors.append(("delete_extension", error))

        if errors:
            for _, error in errors:
                if not isinstance(error, Exception):
                    raise error
            raise BrowserbaseSessionCleanupError(
                tuple(operation for operation, _ in errors)
            ) from None


async def create_browserbase_session(
    api_key: str,
    source: BrowserbaseBrowserSource,
) -> BrowserbaseSession:
    return await BrowserbaseSessionClient(api_key).create_session(source)


def load_stagehand_extension_archive() -> bytes:
    packaged_archive = Path(__file__).with_name("_extension") / _STAGEHAND_EXTENSION_ARCHIVE_NAME
    source_archive = (
        Path(__file__).resolve().parents[3]
        / "server"
        / "artifacts"
        / _STAGEHAND_EXTENSION_ARCHIVE_NAME
    )
    for archive in (packaged_archive, source_archive):
        if archive.is_file():
            return archive.read_bytes()
    raise BrowserbaseSessionError(
        BrowserbaseSessionErrorCode.MISSING_EXTENSION_ARCHIVE,
        (
            "The Stagehand extension archive is not installed. "
            "Build the Python distribution with the Stagehand extension ZIP."
        ),
    )


async def _delete_extension_best_effort(
    api: _BrowserbaseSessionAPI,
    extension_id: str,
) -> None:
    try:
        await api.delete_extension(BrowserbaseExtensionDeleteRequest(extension_id=extension_id))
    except Exception:
        pass


async def _cleanup_invalid_session(
    api: _BrowserbaseSessionAPI,
    session_id: str,
    extension_id: str,
) -> None:
    if session_id:
        try:
            await api.release_session(BrowserbaseSessionReleaseRequest(session_id=session_id))
        except Exception:
            pass
    await _delete_extension_best_effort(api, extension_id)
