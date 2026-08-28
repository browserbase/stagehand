from __future__ import annotations

import asyncio
import io
import os
import zipfile
from collections.abc import Mapping
from importlib.metadata import version
from pathlib import Path
from typing import Any

import pytest

from stagehand import browserbase_session
from stagehand._generated.models import (
    Browser,
    BrowserbaseBrowserSettings,
    BrowserbaseContext,
    BrowserbaseFingerprint,
    BrowserbaseFingerprintScreen,
    BrowserbaseProxyConfig,
    BrowserbaseProxyGeolocation,
    BrowserbaseRegion,
    BrowserbaseSessionCreateParams,
    BrowserbaseViewport,
    Device,
    ExternalProxyConfig,
    HttpVersion,
    OperatingSystem,
    Os,
    ProxyConfig,
)
from stagehand.browserbase_session import (
    BrowserbaseSessionError,
    _BrowserbaseSessionClient,
    _session_create_kwargs,
)
from stagehand.extension_assets import build_extension_archive


class FakeBrowserbaseAPI:
    def __init__(self) -> None:
        self.upload_result = "uploaded-extension"
        self.upload_error: Exception | None = None
        self.create_result = ("session-id", "wss://browser")
        self.create_error: BaseException | None = None
        self.retrieve_result: tuple[str, str | None, BrowserbaseRegion | None] = (
            "session-id",
            "wss://browser",
            None,
        )
        self.retrieve_error: Exception | None = None
        self.release_errors: list[Exception | None] = []
        self.delete_errors: list[Exception | None] = []
        self.upload_calls: list[bytes] = []
        self.create_calls: list[
            tuple[BrowserbaseSessionCreateParams, Mapping[str, Any], str | None]
        ] = []
        self.retrieve_calls: list[str] = []
        self.release_calls: list[str] = []
        self.delete_calls: list[str] = []

    async def upload_extension(self, archive: bytes) -> str:
        self.upload_calls.append(archive)
        if self.upload_error is not None:
            raise self.upload_error
        return self.upload_result

    async def delete_extension(self, extension_id: str) -> None:
        self.delete_calls.append(extension_id)
        error = self.delete_errors.pop(0) if self.delete_errors else None
        if error is not None:
            raise error

    async def create_session(
        self,
        options: BrowserbaseSessionCreateParams,
        *,
        user_metadata: Mapping[str, Any],
        extension_id: str | None,
    ) -> tuple[str, str]:
        self.create_calls.append((options, user_metadata, extension_id))
        if self.create_error is not None:
            raise self.create_error
        return self.create_result

    async def retrieve_session(
        self,
        session_id: str,
    ) -> tuple[str, str | None, BrowserbaseRegion | None]:
        self.retrieve_calls.append(session_id)
        if self.retrieve_error is not None:
            raise self.retrieve_error
        return self.retrieve_result

    async def release_session(self, session_id: str) -> None:
        self.release_calls.append(session_id)
        error = self.release_errors.pop(0) if self.release_errors else None
        if error is not None:
            raise error


@pytest.fixture
def fake_api(monkeypatch: pytest.MonkeyPatch) -> FakeBrowserbaseAPI:
    monkeypatch.setattr(browserbase_session, "build_extension_archive", lambda: b"archive")
    return FakeBrowserbaseAPI()


def test_session_create_kwargs_camel_cases_fingerprint_fields() -> None:
    options = BrowserbaseSessionCreateParams(
        browser_settings=BrowserbaseBrowserSettings(
            advanced_stealth=True,
            context=BrowserbaseContext(id="context-id", persist=True),
            extension_id="nested-extension",
            fingerprint=BrowserbaseFingerprint(
                browsers=[Browser.chrome, Browser.firefox],
                devices=[Device.desktop, Device.mobile],
                http_version=HttpVersion.field_2,
                locales=["en-US", "fr-FR"],
                operating_systems=[OperatingSystem.linux, OperatingSystem.macos],
                screen=BrowserbaseFingerprintScreen(
                    max_height=1440.0,
                    max_width=2560.0,
                    min_height=720.0,
                    min_width=1280.0,
                ),
            ),
            os=Os.linux,
            viewport=BrowserbaseViewport(width=1920.0, height=1080.0),
        ),
        extension_id="options-extension",
        keep_alive=True,
        proxies=[
            ProxyConfig(
                BrowserbaseProxyConfig(
                    type="browserbase",
                    domain_pattern="*.example.com",
                    geolocation=BrowserbaseProxyGeolocation(
                        country="US",
                        city="San Francisco",
                        state="CA",
                    ),
                )
            ),
            ProxyConfig(
                ExternalProxyConfig(
                    type="external",
                    server="http://proxy.example.com",
                    domain_pattern="example.org",
                    username="user",
                    password="password",
                )
            ),
        ],
        region=BrowserbaseRegion.us_west_2,
        timeout=30.0,
        user_metadata={"source": "options"},
    )

    kwargs = _session_create_kwargs(
        options,
        user_metadata={"source": "argument"},
        extension_id="argument-extension",
    )

    assert kwargs["browser_settings"]["fingerprint"] == {
        "browsers": ["chrome", "firefox"],
        "devices": ["desktop", "mobile"],
        "httpVersion": "2",
        "locales": ["en-US", "fr-FR"],
        "operatingSystems": ["linux", "macos"],
        "screen": {
            "maxHeight": 1440.0,
            "maxWidth": 2560.0,
            "minHeight": 720.0,
            "minWidth": 1280.0,
        },
    }
    assert kwargs["browser_settings"]["advanced_stealth"] is True
    assert "timeout" not in kwargs
    assert kwargs["api_timeout"] == 30.0
    assert kwargs["extension_id"] == "argument-extension"
    assert kwargs["user_metadata"] == {"source": "argument"}


def test_session_create_kwargs_renames_only_present_fingerprint_fields() -> None:
    options = BrowserbaseSessionCreateParams(
        browser_settings=BrowserbaseBrowserSettings(
            fingerprint=BrowserbaseFingerprint(http_version=HttpVersion.field_1)
        )
    )

    kwargs = _session_create_kwargs(options, user_metadata={}, extension_id=None)

    assert kwargs["browser_settings"]["fingerprint"] == {"httpVersion": "1"}


def test_session_create_kwargs_omits_absent_optional_fields() -> None:
    kwargs = _session_create_kwargs(
        BrowserbaseSessionCreateParams(),
        user_metadata={"stagehand": "true"},
        extension_id=None,
    )

    assert "browser_settings" not in kwargs
    assert "extension_id" not in kwargs
    assert "api_timeout" not in kwargs
    assert kwargs["user_metadata"] == {"stagehand": "true"}


async def test_create_uploads_extension_and_merges_metadata(fake_api: FakeBrowserbaseAPI) -> None:
    options = BrowserbaseSessionCreateParams(
        user_metadata={
            "tenant": "acme",
            "stagehand": "caller",
            "stagehand_sdk_language": "caller",
            "stagehand_sdk_version": "0.0.0-spoofed",
        }
    )
    session = await _BrowserbaseSessionClient(fake_api).create_session(options)

    assert fake_api.upload_calls == [b"archive"]
    _, metadata, extension_id = fake_api.create_calls[-1]
    assert extension_id == "uploaded-extension"
    assert metadata == {
        "tenant": "acme",
        "stagehand": "true",
        "stagehand_sdk_language": "python",
        "stagehand_sdk_version": version("stagehand"),
    }
    await session.close()


@pytest.mark.parametrize("nested", [False, True])
async def test_caller_extension_is_never_uploaded_or_deleted(
    fake_api: FakeBrowserbaseAPI,
    nested: bool,
) -> None:
    options = (
        BrowserbaseSessionCreateParams(
            browser_settings=BrowserbaseBrowserSettings(extension_id="caller-extension")
        )
        if nested
        else BrowserbaseSessionCreateParams(extension_id="caller-extension")
    )
    session = await _BrowserbaseSessionClient(fake_api).create_session(options)
    await session.close()

    assert fake_api.upload_calls == []
    assert fake_api.create_calls[-1][2] == (None if nested else "caller-extension")
    assert fake_api.delete_calls == []
    assert fake_api.release_calls == ["session-id"]


async def test_create_failure_deletes_owned_extension_best_effort(
    fake_api: FakeBrowserbaseAPI,
) -> None:
    fake_api.create_error = OSError("secret API failure")
    fake_api.delete_errors = [OSError("cleanup failed")]
    with pytest.raises(
        BrowserbaseSessionError,
        match="^Failed to create a Browserbase session$",
    ) as raised:
        await _BrowserbaseSessionClient(fake_api).create_session(BrowserbaseSessionCreateParams())
    assert raised.value.__cause__ is None
    assert fake_api.delete_calls == ["uploaded-extension"]


async def test_create_cancellation_deletes_owned_extension(
    fake_api: FakeBrowserbaseAPI,
) -> None:
    fake_api.create_error = asyncio.CancelledError()
    with pytest.raises(asyncio.CancelledError):
        await _BrowserbaseSessionClient(fake_api).create_session(BrowserbaseSessionCreateParams())
    assert fake_api.delete_calls == ["uploaded-extension"]


@pytest.mark.parametrize(
    ("create_result", "expected", "released"),
    [
        (("  ", "wss://browser"), "empty session ID", []),
        ((" session ", "  "), "empty connection URL", ["session"]),
    ],
)
async def test_empty_create_results_are_cleaned_up(
    fake_api: FakeBrowserbaseAPI,
    create_result: tuple[str, str],
    expected: str,
    released: list[str],
) -> None:
    fake_api.create_result = create_result
    with pytest.raises(BrowserbaseSessionError, match=expected):
        await _BrowserbaseSessionClient(fake_api).create_session(BrowserbaseSessionCreateParams())
    assert fake_api.release_calls == released
    assert fake_api.delete_calls == ["uploaded-extension"]


@pytest.mark.parametrize(
    ("upload_result", "upload_error", "expected"),
    [
        (
            "uploaded",
            OSError("upload failed"),
            "Failed to upload the Stagehand extension to Browserbase",
        ),
        ("  ", None, "Browserbase extension upload returned an empty extension ID"),
    ],
)
async def test_upload_failures_have_exact_messages(
    fake_api: FakeBrowserbaseAPI,
    upload_result: str,
    upload_error: Exception | None,
    expected: str,
) -> None:
    fake_api.upload_result = upload_result
    fake_api.upload_error = upload_error
    with pytest.raises(RuntimeError, match=f"^{expected}$"):
        await _BrowserbaseSessionClient(fake_api).create_session(BrowserbaseSessionCreateParams())


async def test_close_releases_and_deletes_once(fake_api: FakeBrowserbaseAPI) -> None:
    session = await _BrowserbaseSessionClient(fake_api).create_session(
        BrowserbaseSessionCreateParams()
    )
    await session.close()
    await session.close()
    assert fake_api.release_calls == ["session-id"]
    assert fake_api.delete_calls == ["uploaded-extension"]


async def test_close_retries_failed_steps_and_release_error_wins(
    fake_api: FakeBrowserbaseAPI,
) -> None:
    release_error = OSError("release failed")
    fake_api.release_errors = [release_error, None]
    fake_api.delete_errors = [LookupError("delete failed"), None]
    session = await _BrowserbaseSessionClient(fake_api).create_session(
        BrowserbaseSessionCreateParams()
    )
    with pytest.raises(OSError, match="release failed") as raised:
        await session.close()
    assert raised.value is release_error
    await session.close()
    await session.close()
    assert fake_api.release_calls == ["session-id", "session-id"]
    assert fake_api.delete_calls == ["uploaded-extension", "uploaded-extension"]


async def test_close_retries_only_extension_cleanup(fake_api: FakeBrowserbaseAPI) -> None:
    fake_api.delete_errors = [OSError("delete failed"), None]
    session = await _BrowserbaseSessionClient(fake_api).create_session(
        BrowserbaseSessionCreateParams()
    )
    with pytest.raises(OSError, match="delete failed"):
        await session.close()
    await session.close()
    assert fake_api.release_calls == ["session-id"]
    assert fake_api.delete_calls == ["uploaded-extension", "uploaded-extension"]


async def test_connect_validates_sanitizes_and_normalizes(
    fake_api: FakeBrowserbaseAPI,
) -> None:
    client = _BrowserbaseSessionClient(fake_api)
    with pytest.raises(BrowserbaseSessionError, match="^A Browserbase session ID is required$"):
        await client.connect_session("  ")
    fake_api.retrieve_error = OSError("secret")
    with pytest.raises(
        BrowserbaseSessionError,
        match="^Failed to retrieve the Browserbase session$",
    ) as raised:
        await client.connect_session(" session ")
    assert raised.value.__cause__ is None
    fake_api.retrieve_error = None
    fake_api.retrieve_result = (" ", None, None)
    with pytest.raises(
        BrowserbaseSessionError,
        match="^Browserbase session is not available for connection$",
    ):
        await client.connect_session(" session ")

    fake_api.retrieve_result = (" retrieved ", " wss://browser ", BrowserbaseRegion.us_east_1)
    connection = await client.connect_session(" input ")
    assert connection.session_id == "retrieved"
    assert connection.cdp_url == "wss://browser"
    assert connection.region == BrowserbaseRegion.us_east_1
    assert fake_api.retrieve_calls[-1] == "input"

    await connection.close()
    await connection.close()
    assert fake_api.release_calls == ["retrieved"]


async def test_connect_preserves_missing_region(fake_api: FakeBrowserbaseAPI) -> None:
    fake_api.retrieve_result = ("session-id", "wss://browser", None)

    connection = await _BrowserbaseSessionClient(fake_api).connect_session("session-id")

    assert connection.region is None


def test_build_extension_archive_places_manifest_at_root(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    (tmp_path / "manifest.json").write_text("{}")
    nested = tmp_path / "scripts"
    nested.mkdir()
    (nested / "worker.js").write_text("worker")
    monkeypatch.setattr("stagehand.extension_assets.extension_directory", lambda: tmp_path)

    with zipfile.ZipFile(io.BytesIO(build_extension_archive())) as archive:
        assert archive.namelist() == ["manifest.json", "scripts/worker.js"]


def test_build_extension_archive_ignores_file_mtime(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    manifest = tmp_path / "manifest.json"
    manifest.write_text("{}")
    monkeypatch.setattr("stagehand.extension_assets.extension_directory", lambda: tmp_path)

    first = build_extension_archive()
    os.utime(manifest, (1_000_000_000, 1_000_000_000))
    second = build_extension_archive()

    assert first == second
