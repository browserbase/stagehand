from __future__ import annotations

import asyncio
from collections.abc import Mapping
from importlib.metadata import version
from typing import Any

import pytest

from stagehand._generated.models import (
    Browser,
    BrowserbaseBrowserSettings,
    BrowserbaseContext,
    BrowserbaseExtension,
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


class FakeBrowserbaseAPI:
    def __init__(self) -> None:
        self.create_result = ("session-id", "wss://browser")
        self.create_error: BaseException | None = None
        self.retrieve_result: tuple[str, str | None, BrowserbaseRegion | None] = (
            "session-id",
            "wss://browser",
            None,
        )
        self.retrieve_error: Exception | None = None
        self.release_errors: list[Exception | None] = []
        self.create_calls: list[
            tuple[BrowserbaseSessionCreateParams, Mapping[str, Any], str | None]
        ] = []
        self.retrieve_calls: list[str] = []
        self.release_calls: list[str] = []

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
def fake_api() -> FakeBrowserbaseAPI:
    return FakeBrowserbaseAPI()


def test_session_create_kwargs_camel_cases_fingerprint_fields() -> None:
    options = BrowserbaseSessionCreateParams(
        browser_settings=BrowserbaseBrowserSettings(
            advanced_stealth=True,
            context=BrowserbaseContext(id="context-id", persist=True),
            extension_id="nested-extension",
            extensions=[BrowserbaseExtension.onepassword, BrowserbaseExtension.stagehand],
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
    assert kwargs["browser_settings"]["extension_id"] == "nested-extension"
    assert kwargs["browser_settings"]["extensions"] == ["onepassword", "stagehand"]
    assert all(type(value) is str for value in kwargs["browser_settings"]["extensions"])
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


async def test_create_opts_into_built_in_extension_and_merges_metadata(
    fake_api: FakeBrowserbaseAPI,
) -> None:
    options = BrowserbaseSessionCreateParams(
        user_metadata={
            "tenant": "acme",
            "stagehand": "caller",
            "stagehand_sdk_language": "caller",
            "stagehand_sdk_version": "0.0.0-spoofed",
        }
    )
    session = await _BrowserbaseSessionClient(fake_api).create_session(options)

    sent, metadata, extension_id = fake_api.create_calls[-1]
    assert extension_id is None
    assert sent.browser_settings is not None
    assert sent.browser_settings.extensions == [BrowserbaseExtension.stagehand]
    assert options.browser_settings is None
    assert metadata == {
        "tenant": "acme",
        "stagehand": "true",
        "stagehand_sdk_language": "python",
        "stagehand_sdk_version": version("stagehand"),
    }
    await session.close()


@pytest.mark.parametrize(
    ("caller", "expected"),
    [
        (None, [BrowserbaseExtension.stagehand]),
        ([], [BrowserbaseExtension.stagehand]),
        (
            [
                BrowserbaseExtension.onepassword,
                BrowserbaseExtension.browser_events,
                BrowserbaseExtension.onepassword,
            ],
            [
                BrowserbaseExtension.onepassword,
                BrowserbaseExtension.browser_events,
                BrowserbaseExtension.stagehand,
            ],
        ),
        (
            [
                BrowserbaseExtension.stagehand,
                BrowserbaseExtension.onepassword,
                BrowserbaseExtension.stagehand,
            ],
            [BrowserbaseExtension.stagehand, BrowserbaseExtension.onepassword],
        ),
    ],
)
async def test_create_dedupes_extensions_and_appends_stagehand_without_mutating_input(
    fake_api: FakeBrowserbaseAPI,
    caller: list[BrowserbaseExtension] | None,
    expected: list[BrowserbaseExtension],
) -> None:
    settings = BrowserbaseBrowserSettings(extension_id="nested-caller", extensions=caller)
    caller_snapshot = None if caller is None else list(caller)
    options = BrowserbaseSessionCreateParams(browser_settings=settings, extension_id="top-caller")

    session = await _BrowserbaseSessionClient(fake_api).create_session(options)
    await session.close()

    sent, _, extension_id = fake_api.create_calls[-1]
    assert extension_id == "top-caller"
    assert sent.extension_id == "top-caller"
    assert sent.browser_settings is not None
    assert sent.browser_settings.extension_id == "nested-caller"
    assert sent.browser_settings.extensions == expected
    assert options.browser_settings is settings
    assert settings.extensions == caller_snapshot


@pytest.mark.parametrize("nested", [False, True])
async def test_caller_extension_passes_through_without_extension_api_calls(
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

    sent, _, extension_id = fake_api.create_calls[-1]
    assert extension_id == (None if nested else "caller-extension")
    assert sent.browser_settings is not None
    assert sent.browser_settings.extension_id == ("caller-extension" if nested else None)
    assert sent.browser_settings.extensions == [BrowserbaseExtension.stagehand]
    assert fake_api.release_calls == ["session-id"]


async def test_create_failure_is_sanitized_and_has_no_cleanup(
    fake_api: FakeBrowserbaseAPI,
) -> None:
    fake_api.create_error = OSError("secret API failure")
    with pytest.raises(
        BrowserbaseSessionError,
        match="^Failed to create a Browserbase session$",
    ) as raised:
        await _BrowserbaseSessionClient(fake_api).create_session(BrowserbaseSessionCreateParams())
    assert raised.value.__cause__ is None
    assert "secret" not in str(raised.value)
    assert fake_api.release_calls == []


async def test_create_cancellation_propagates_without_cleanup(
    fake_api: FakeBrowserbaseAPI,
) -> None:
    fake_api.create_error = asyncio.CancelledError()
    with pytest.raises(asyncio.CancelledError):
        await _BrowserbaseSessionClient(fake_api).create_session(BrowserbaseSessionCreateParams())
    assert fake_api.release_calls == []


@pytest.mark.parametrize(
    ("create_result", "expected", "released"),
    [
        (("  ", "wss://browser"), "empty session ID", []),
        ((" session ", "  "), "empty connection URL", ["session"]),
    ],
)
async def test_empty_create_results_release_only_the_session(
    fake_api: FakeBrowserbaseAPI,
    create_result: tuple[str, str],
    expected: str,
    released: list[str],
) -> None:
    fake_api.create_result = create_result
    with pytest.raises(BrowserbaseSessionError, match=expected):
        await _BrowserbaseSessionClient(fake_api).create_session(BrowserbaseSessionCreateParams())
    assert fake_api.release_calls == released


async def test_close_releases_once(fake_api: FakeBrowserbaseAPI) -> None:
    session = await _BrowserbaseSessionClient(fake_api).create_session(
        BrowserbaseSessionCreateParams()
    )
    await session.close()
    await session.close()
    assert fake_api.release_calls == ["session-id"]


async def test_close_retries_failed_release(
    fake_api: FakeBrowserbaseAPI,
) -> None:
    release_error = OSError("release failed")
    fake_api.release_errors = [release_error, None]
    session = await _BrowserbaseSessionClient(fake_api).create_session(
        BrowserbaseSessionCreateParams()
    )
    with pytest.raises(OSError, match="release failed") as raised:
        await session.close()
    assert raised.value is release_error
    await session.close()
    await session.close()
    assert fake_api.release_calls == ["session-id", "session-id"]


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


async def test_connect_preserves_missing_region(fake_api: FakeBrowserbaseAPI) -> None:
    fake_api.retrieve_result = ("session-id", "wss://browser", None)

    connection = await _BrowserbaseSessionClient(fake_api).connect_session("session-id")

    assert connection.region is None
