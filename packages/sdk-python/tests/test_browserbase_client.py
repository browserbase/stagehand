from __future__ import annotations

import json
from typing import cast

import httpx
import pytest
from pydantic import ValidationError

from stagehand.browserbase_client import (
    BrowserbaseAPIError,
    BrowserbaseBrowserSettingsRequest,
    BrowserbaseClient,
    BrowserbaseContextRequest,
    BrowserbaseExtensionDeleteRequest,
    BrowserbaseExtensionResponse,
    BrowserbaseExtensionUploadRequest,
    BrowserbaseExternalProxyRequest,
    BrowserbaseFingerprintRequest,
    BrowserbaseFingerprintScreenRequest,
    BrowserbaseManagedProxyRequest,
    BrowserbaseProxyGeolocationRequest,
    BrowserbaseSessionCreateRequest,
    BrowserbaseSessionReleaseRequest,
    BrowserbaseSessionReleaseResponse,
    BrowserbaseSessionResponse,
    BrowserbaseViewportRequest,
)


@pytest.mark.asyncio
async def test_browserbase_client_uses_typed_endpoint_models() -> None:
    requests: list[httpx.Request] = []

    def handle(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        assert request.headers["X-BB-API-Key"] == "bb_test"
        if request.method == "POST" and request.url.path == "/v1/extensions":
            return httpx.Response(200, json={"id": "ext_stagehand", "futureField": "accepted"})
        if request.method == "POST" and request.url.path == "/v1/sessions":
            return httpx.Response(
                200,
                json={
                    "id": "session_123",
                    "connectUrl": ("wss://connect.browserbase.com/devtools/browser/session_123"),
                    "futureField": "accepted",
                },
            )
        if request.method == "POST" and request.url.path == "/v1/sessions/session_123":
            return httpx.Response(
                200,
                json={"id": "session_123", "status": "COMPLETED", "futureField": "accepted"},
            )
        if request.method == "DELETE" and request.url.path == "/v1/extensions/ext_stagehand":
            return httpx.Response(204)
        return httpx.Response(404, json={"message": "not found"})

    http_client = httpx.AsyncClient(transport=httpx.MockTransport(handle))
    client = BrowserbaseClient(
        "bb_test",
        base_url="https://api.browserbase.test",
        http_client=http_client,
    )

    extension = await client.upload_extension(
        BrowserbaseExtensionUploadRequest(archive=b"test-stagehand-extension")
    )
    session = await client.create_session(_full_session_request())
    released = await client.release_session(
        BrowserbaseSessionReleaseRequest(session_id="session_123")
    )
    await client.delete_extension(BrowserbaseExtensionDeleteRequest(extension_id="ext_stagehand"))
    await http_client.aclose()

    assert extension == BrowserbaseExtensionResponse.model_validate({
        "id": "ext_stagehand",
        "futureField": "accepted",
    })
    assert session == BrowserbaseSessionResponse.model_validate({
        "id": "session_123",
        "connectUrl": "wss://connect.browserbase.com/devtools/browser/session_123",
        "futureField": "accepted",
    })
    assert released == BrowserbaseSessionReleaseResponse.model_validate({
        "id": "session_123",
        "status": "COMPLETED",
        "futureField": "accepted",
    })
    assert [f"{request.method} {request.url.path}" for request in requests] == [
        "POST /v1/extensions",
        "POST /v1/sessions",
        "POST /v1/sessions/session_123",
        "DELETE /v1/extensions/ext_stagehand",
    ]

    upload_request = requests[0]
    assert upload_request.headers["Content-Type"].startswith("multipart/form-data; boundary=")
    assert b'name="file"; filename="stagehand-extension.zip"' in upload_request.content
    assert b"test-stagehand-extension" in upload_request.content
    assert json.loads(requests[1].content) == _expected_session_body()
    assert json.loads(requests[2].content) == {"status": "REQUEST_RELEASE"}
    assert "Content-Type" not in requests[3].headers
    assert requests[3].headers["Accept"] == "*/*"


def test_browserbase_request_models_validate_before_transport() -> None:
    with pytest.raises(ValidationError, match="extra_forbidden"):
        BrowserbaseSessionCreateRequest.model_validate({"unknown": True})
    with pytest.raises(ValidationError, match="less than or equal to 21600"):
        BrowserbaseSessionCreateRequest(timeout=21_601)
    with pytest.raises(ValidationError, match="extension ID cannot be empty"):
        BrowserbaseExtensionDeleteRequest(extension_id=" ")


@pytest.mark.parametrize(
    "timeout",
    [0.0, -1.0, float("nan"), float("inf"), float("-inf")],
)
def test_browserbase_client_requires_a_positive_finite_http_timeout(timeout: float) -> None:
    with pytest.raises(ValueError, match="positive and finite"):
        BrowserbaseClient("bb_test", timeout=timeout)


@pytest.mark.asyncio
async def test_browserbase_client_requires_pydantic_requests() -> None:
    client = BrowserbaseClient(
        "bb_test",
        base_url="https://api.browserbase.test",
        http_client=httpx.AsyncClient(transport=httpx.MockTransport(lambda _: httpx.Response(500))),
    )

    with pytest.raises(TypeError, match="BrowserbaseSessionCreateRequest"):
        await client.create_session(cast(BrowserbaseSessionCreateRequest, {}))
    await client._http_client.aclose()


@pytest.mark.asyncio
async def test_browserbase_client_rejects_invalid_responses() -> None:
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(lambda _: httpx.Response(200, json={"id": "session_123"}))
    ) as http_client:
        client = BrowserbaseClient(
            "bb_test",
            base_url="https://api.browserbase.test",
            http_client=http_client,
        )
        with pytest.raises(ValidationError, match="connectUrl"):
            await client.create_session(BrowserbaseSessionCreateRequest())


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "connect_url",
    [
        "https://connect.browserbase.com/devtools/browser/session_123",
        "/devtools/browser/session_123",
        "not a URL",
    ],
)
async def test_browserbase_client_rejects_non_websocket_connection_urls(
    connect_url: str,
) -> None:
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(
            lambda _: httpx.Response(
                200,
                json={"id": "session_123", "connectUrl": connect_url},
            )
        )
    ) as http_client:
        client = BrowserbaseClient(
            "bb_test",
            base_url="https://api.browserbase.test",
            http_client=http_client,
        )
        with pytest.raises(ValidationError, match="connectUrl"):
            await client.create_session(BrowserbaseSessionCreateRequest())


@pytest.mark.asyncio
async def test_browserbase_client_returns_typed_api_errors() -> None:
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(
            lambda _: httpx.Response(
                429,
                json={"message": "concurrency limit reached"},
                headers={"x-request-id": "request_123"},
            )
        )
    ) as http_client:
        client = BrowserbaseClient(
            "bb_test",
            base_url="https://api.browserbase.test",
            http_client=http_client,
        )
        with pytest.raises(BrowserbaseAPIError, match="concurrency limit reached") as caught:
            await client.create_session(BrowserbaseSessionCreateRequest())

    assert caught.value.status_code == 429
    assert caught.value.request_id == "request_123"


@pytest.mark.asyncio
async def test_browserbase_client_treats_redirects_as_api_errors() -> None:
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(
            lambda _: httpx.Response(
                302,
                json={
                    "id": "session_123",
                    "connectUrl": "wss://connect.browserbase.com/devtools/browser/session_123",
                },
                headers={"x-request-id": "request_redirect"},
            )
        )
    ) as http_client:
        client = BrowserbaseClient(
            "bb_test",
            base_url="https://api.browserbase.test",
            http_client=http_client,
        )
        with pytest.raises(BrowserbaseAPIError) as caught:
            await client.create_session(BrowserbaseSessionCreateRequest())

    assert caught.value.status_code == 302
    assert caught.value.request_id == "request_redirect"
    assert '"id":"session_123"' in caught.value.body


def _full_session_request() -> BrowserbaseSessionCreateRequest:
    return BrowserbaseSessionCreateRequest(
        browser_settings=BrowserbaseBrowserSettingsRequest(
            advanced_stealth=True,
            block_ads=False,
            context=BrowserbaseContextRequest(id="context_123", persist=True),
            extension_id="ext_settings",
            fingerprint=BrowserbaseFingerprintRequest(
                browsers=["chrome"],
                devices=["desktop"],
                http_version="2",
                locales=["de-CH", "en-US"],
                operating_systems=["macos"],
                screen=BrowserbaseFingerprintScreenRequest(min_width=1024),
            ),
            log_session=False,
            os="mac",
            record_session=True,
            solve_captchas=True,
            verified=False,
            viewport=BrowserbaseViewportRequest(width=1280, height=800),
        ),
        extension_id="ext_stagehand",
        keep_alive=True,
        proxies=[
            BrowserbaseManagedProxyRequest(
                type="browserbase",
                domain_pattern="*.example.com",
                geolocation=BrowserbaseProxyGeolocationRequest(
                    country="CH",
                    city="Zurich",
                ),
            ),
            BrowserbaseExternalProxyRequest(
                type="external",
                server="http://proxy.example:8080",
                username="proxy-user",
                password="proxy-password",
            ),
        ],
        region="eu-central-1",
        timeout=300,
        user_metadata={
            "suite": "python-browserbase-client",
            "attempt": 3,
        },
    )


def _expected_session_body() -> dict[str, object]:
    return {
        "browserSettings": {
            "advancedStealth": True,
            "blockAds": False,
            "context": {"id": "context_123", "persist": True},
            "extensionId": "ext_settings",
            "fingerprint": {
                "browsers": ["chrome"],
                "devices": ["desktop"],
                "httpVersion": "2",
                "locales": ["de-CH", "en-US"],
                "operatingSystems": ["macos"],
                "screen": {"minWidth": 1024.0},
            },
            "logSession": False,
            "os": "mac",
            "recordSession": True,
            "solveCaptchas": True,
            "verified": False,
            "viewport": {"width": 1280.0, "height": 800.0},
        },
        "extensionId": "ext_stagehand",
        "keepAlive": True,
        "proxies": [
            {
                "type": "browserbase",
                "domainPattern": "*.example.com",
                "geolocation": {"country": "CH", "city": "Zurich"},
            },
            {
                "type": "external",
                "server": "http://proxy.example:8080",
                "username": "proxy-user",
                "password": "proxy-password",
            },
        ],
        "region": "eu-central-1",
        "timeout": 300.0,
        "userMetadata": {
            "suite": "python-browserbase-client",
            "attempt": 3,
        },
    }
