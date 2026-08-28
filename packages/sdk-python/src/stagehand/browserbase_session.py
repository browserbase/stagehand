from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass, field
from typing import Any, Protocol

from ._generated.models import BrowserbaseRegion, BrowserbaseSessionCreateParams
from ._sdk_identity import STAGEHAND_SESSION_METADATA
from .extension_assets import build_extension_archive

DEFAULT_BROWSERBASE_URL = "https://api.browserbase.com"


class BrowserbaseSessionError(RuntimeError):
    pass


def _session_create_kwargs(
    options: BrowserbaseSessionCreateParams,
    *,
    user_metadata: Mapping[str, Any],
    extension_id: str | None,
) -> dict[str, Any]:
    values: dict[str, Any] = options.model_dump(
        by_alias=False,
        exclude_none=True,
        exclude={"extension_id", "user_metadata", "timeout"},
    )
    browser_settings = values.get("browser_settings")
    if isinstance(browser_settings, dict):
        fingerprint = browser_settings.get("fingerprint")
        if isinstance(fingerprint, dict):
            fingerprint_key_mapping = {
                "http_version": "httpVersion",
                "operating_systems": "operatingSystems",
            }
            for source_key, target_key in fingerprint_key_mapping.items():
                if source_key in fingerprint:
                    fingerprint[target_key] = fingerprint.pop(source_key)

            screen = fingerprint.get("screen")
            if isinstance(screen, dict):
                screen_key_mapping = {
                    "max_height": "maxHeight",
                    "max_width": "maxWidth",
                    "min_height": "minHeight",
                    "min_width": "minWidth",
                }
                for source_key, target_key in screen_key_mapping.items():
                    if source_key in screen:
                        screen[target_key] = screen.pop(source_key)

    kwargs: dict[str, Any] = {**values, "user_metadata": dict(user_metadata)}
    if extension_id is not None:
        kwargs["extension_id"] = extension_id
    if options.timeout is not None:
        kwargs["api_timeout"] = options.timeout
    return kwargs


class _BrowserbaseAPI(Protocol):
    async def upload_extension(self, archive: bytes) -> str: ...

    async def delete_extension(self, extension_id: str) -> None: ...

    async def create_session(
        self,
        options: BrowserbaseSessionCreateParams,
        *,
        user_metadata: Mapping[str, Any],
        extension_id: str | None,
    ) -> tuple[str, str]: ...

    async def retrieve_session(
        self,
        session_id: str,
    ) -> tuple[str, str | None, BrowserbaseRegion | None]: ...

    async def release_session(self, session_id: str) -> None: ...


class _OfficialBrowserbaseAPI:
    def __init__(self, api_key: str, base_url: str) -> None:
        self._api_key = api_key
        self._base_url = base_url

    async def upload_extension(self, archive: bytes) -> str:
        from browserbase import AsyncBrowserbase

        async with AsyncBrowserbase(api_key=self._api_key, base_url=self._base_url) as client:
            extension = await client.extensions.create(file=("stagehand-extension.zip", archive))
        return extension.id

    async def delete_extension(self, extension_id: str) -> None:
        from browserbase import AsyncBrowserbase, omit

        async with AsyncBrowserbase(api_key=self._api_key, base_url=self._base_url) as client:
            await client.extensions.delete(extension_id, extra_headers={"Content-Type": omit})

    async def create_session(
        self,
        options: BrowserbaseSessionCreateParams,
        *,
        user_metadata: Mapping[str, Any],
        extension_id: str | None,
    ) -> tuple[str, str]:
        from browserbase import AsyncBrowserbase

        kwargs = _session_create_kwargs(
            options,
            user_metadata=user_metadata,
            extension_id=extension_id,
        )
        async with AsyncBrowserbase(api_key=self._api_key, base_url=self._base_url) as client:
            session = await client.sessions.create(**kwargs)
        return session.id, session.connect_url

    async def retrieve_session(
        self,
        session_id: str,
    ) -> tuple[str, str | None, BrowserbaseRegion | None]:
        from browserbase import AsyncBrowserbase

        async with AsyncBrowserbase(api_key=self._api_key, base_url=self._base_url) as client:
            session = await client.sessions.retrieve(session_id)
        return (
            session.id,
            session.connect_url,
            (BrowserbaseRegion(session.region) if session.region is not None else None),
        )

    async def release_session(self, session_id: str) -> None:
        from browserbase import AsyncBrowserbase

        async with AsyncBrowserbase(api_key=self._api_key, base_url=self._base_url) as client:
            await client.sessions.update(session_id, status="REQUEST_RELEASE")


@dataclass(frozen=True)
class _BrowserbaseSessionConnection:
    session_id: str
    cdp_url: str
    region: BrowserbaseRegion | None = None
    _close_callback: Callable[[], Awaitable[None]] | None = field(default=None, repr=False)

    async def close(self) -> None:
        if self._close_callback is not None:
            await self._close_callback()


@dataclass
class _OwnedBrowserbaseSession:
    session_id: str
    cdp_url: str
    _api: _BrowserbaseAPI = field(repr=False)
    _extension_id: str | None = field(repr=False)
    _session_released: bool = field(default=False, init=False, repr=False)
    _extension_deleted: bool = field(default=False, init=False, repr=False)
    _close_lock: asyncio.Lock = field(default_factory=asyncio.Lock, init=False, repr=False)

    async def close(self) -> None:
        async with self._close_lock:
            release_error: Exception | None = None
            if not self._session_released:
                try:
                    await self._api.release_session(self.session_id)
                except Exception as error:
                    release_error = error
                else:
                    self._session_released = True

            extension_error: Exception | None = None
            if self._extension_id is not None and not self._extension_deleted:
                try:
                    await self._api.delete_extension(self._extension_id)
                except Exception as error:
                    extension_error = error
                else:
                    self._extension_deleted = True

            if release_error is not None:
                raise release_error
            if extension_error is not None:
                raise extension_error


class _BrowserbaseSessionClient:
    def __init__(self, api: _BrowserbaseAPI) -> None:
        self._api = api

    async def create_session(
        self,
        options: BrowserbaseSessionCreateParams,
    ) -> _OwnedBrowserbaseSession:
        caller_extension_id = options.extension_id
        if caller_extension_id is None and options.browser_settings is not None:
            caller_extension_id = options.browser_settings.extension_id

        owned_extension_id: str | None = None
        if caller_extension_id is None:
            archive = await asyncio.to_thread(build_extension_archive)
            try:
                uploaded_extension_id = await self._api.upload_extension(archive)
            except Exception as error:
                raise RuntimeError(
                    "Failed to upload the Stagehand extension to Browserbase"
                ) from error
            owned_extension_id = uploaded_extension_id.strip()
            if not owned_extension_id:
                raise RuntimeError("Browserbase extension upload returned an empty extension ID")

        extension_id = owned_extension_id or options.extension_id
        user_metadata = {
            **(options.user_metadata or {}),
            **STAGEHAND_SESSION_METADATA,
        }
        try:
            raw_session_id, raw_cdp_url = await self._api.create_session(
                options,
                user_metadata=user_metadata,
                extension_id=extension_id,
            )
        except BaseException as error:
            await self._delete_extension_best_effort(owned_extension_id)
            if isinstance(error, Exception):
                raise BrowserbaseSessionError("Failed to create a Browserbase session") from None
            raise

        session_id = raw_session_id.strip()
        cdp_url = raw_cdp_url.strip()
        if not session_id or not cdp_url:
            await self._cleanup_invalid_session(session_id, owned_extension_id)
            if not session_id:
                raise BrowserbaseSessionError(
                    "Browserbase session creation returned an empty session ID"
                )
            raise BrowserbaseSessionError(
                "Browserbase session creation returned an empty connection URL"
            )

        return _OwnedBrowserbaseSession(
            session_id=session_id,
            cdp_url=cdp_url,
            _api=self._api,
            _extension_id=owned_extension_id,
        )

    async def connect_session(self, session_id: str) -> _BrowserbaseSessionConnection:
        normalized_session_id = session_id.strip()
        if not normalized_session_id:
            raise BrowserbaseSessionError("A Browserbase session ID is required")
        try:
            retrieved_id, connect_url, region = await self._api.retrieve_session(
                normalized_session_id
            )
        except Exception:
            raise BrowserbaseSessionError("Failed to retrieve the Browserbase session") from None
        cdp_url = connect_url.strip() if connect_url is not None else ""
        if not cdp_url:
            raise BrowserbaseSessionError("Browserbase session is not available for connection")
        released = False
        close_lock = asyncio.Lock()

        async def close() -> None:
            nonlocal released
            async with close_lock:
                if released:
                    return
                await self._api.release_session(retrieved_id.strip() or normalized_session_id)
                released = True

        return _BrowserbaseSessionConnection(
            session_id=retrieved_id.strip() or normalized_session_id,
            cdp_url=cdp_url,
            region=region,
            _close_callback=close,
        )

    async def _delete_extension_best_effort(self, extension_id: str | None) -> None:
        if extension_id is None:
            return
        try:
            await self._api.delete_extension(extension_id)
        except Exception:
            pass

    async def _cleanup_invalid_session(
        self,
        session_id: str,
        extension_id: str | None,
    ) -> None:
        if session_id:
            try:
                await self._api.release_session(session_id)
            except Exception:
                pass
        await self._delete_extension_best_effort(extension_id)


def _create_browserbase_session_client(api_key: str, base_url: str) -> _BrowserbaseSessionClient:
    return _BrowserbaseSessionClient(_OfficialBrowserbaseAPI(api_key, base_url))
