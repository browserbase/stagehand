from __future__ import annotations

import zipfile
from io import BytesIO

import pytest
from pydantic import ValidationError

from stagehand.browserbase_client import (
    BrowserbaseExtensionDeleteRequest,
    BrowserbaseExtensionResponse,
    BrowserbaseExtensionUploadRequest,
    BrowserbaseSessionCreateRequest,
    BrowserbaseSessionReleaseRequest,
    BrowserbaseSessionResponse,
)
from stagehand.browserbase_session import (
    BrowserbaseSessionClient,
    load_stagehand_extension_archive,
)
from stagehand.client_models import BrowserbaseBrowserSource


class FakeBrowserbaseAPI:
    def __init__(self) -> None:
        self.upload_requests: list[BrowserbaseExtensionUploadRequest] = []
        self.create_requests: list[BrowserbaseSessionCreateRequest] = []
        self.release_requests: list[BrowserbaseSessionReleaseRequest] = []
        self.delete_requests: list[BrowserbaseExtensionDeleteRequest] = []
        self.create_error: BaseException | None = None
        self.release_error: BaseException | None = None
        self.delete_error: BaseException | None = None

    async def upload_extension(
        self,
        request: BrowserbaseExtensionUploadRequest,
    ) -> BrowserbaseExtensionResponse:
        self.upload_requests.append(request)
        return BrowserbaseExtensionResponse(id="ext_stagehand")

    async def create_session(
        self,
        request: BrowserbaseSessionCreateRequest,
    ) -> BrowserbaseSessionResponse:
        self.create_requests.append(request)
        if self.create_error is not None:
            raise self.create_error
        return BrowserbaseSessionResponse.model_validate({
            "id": "session_123",
            "connect_url": ("wss://connect.browserbase.com/devtools/browser/session_123"),
        })

    async def release_session(
        self,
        request: BrowserbaseSessionReleaseRequest,
    ) -> object:
        self.release_requests.append(request)
        if self.release_error is not None:
            raise self.release_error
        return object()

    async def delete_extension(
        self,
        request: BrowserbaseExtensionDeleteRequest,
    ) -> None:
        self.delete_requests.append(request)
        if self.delete_error is not None:
            raise self.delete_error


@pytest.mark.asyncio
async def test_browserbase_session_provisions_the_stagehand_extension() -> None:
    api = FakeBrowserbaseAPI()
    source = BrowserbaseBrowserSource.model_validate({
        "type": "browserbase",
        "browser_settings": {
            "advanced_stealth": True,
            "viewport": {"width": 1280, "height": 800},
        },
        "keep_alive": False,
        "region": "eu-central-1",
        "timeout": 300,
        "user_metadata": {
            "suite": "unit",
            "stagehand": "false",
            "stagehand_sdk_language": "typescript",
        },
    })
    client = BrowserbaseSessionClient(
        "bb_test",
        api=api,
        archive_loader=lambda: b"stagehand-extension",
    )

    session = await client.create_session(source)

    assert session.session_id == "session_123"
    assert session.cdp_url == ("wss://connect.browserbase.com/devtools/browser/session_123")
    assert api.upload_requests[0].archive == b"stagehand-extension"
    assert api.create_requests[0].model_dump(mode="json", exclude_none=True) == {
        "browserSettings": {
            "advancedStealth": True,
            "viewport": {"width": 1280.0, "height": 800.0},
        },
        "extensionId": "ext_stagehand",
        "keepAlive": False,
        "region": "eu-central-1",
        "timeout": 300.0,
        "userMetadata": {
            "suite": "unit",
            "stagehand": "true",
            "stagehand_sdk_language": "python",
        },
    }

    await session.close()
    await session.close()

    assert [request.session_id for request in api.release_requests] == ["session_123"]
    assert [request.extension_id for request in api.delete_requests] == ["ext_stagehand"]


@pytest.mark.asyncio
async def test_browserbase_session_validates_before_uploading() -> None:
    api = FakeBrowserbaseAPI()
    source = BrowserbaseBrowserSource(
        type="browserbase",
        user_metadata={"not_json": object()},
    )
    client = BrowserbaseSessionClient(
        "bb_test",
        api=api,
        archive_loader=lambda: b"stagehand-extension",
    )

    with pytest.raises(ValidationError, match="user_metadata"):
        await client.create_session(source)

    assert api.upload_requests == []


@pytest.mark.asyncio
async def test_browserbase_session_deletes_the_extension_after_create_failure() -> None:
    api = FakeBrowserbaseAPI()
    create_error = RuntimeError("concurrency limit reached")
    api.create_error = create_error
    client = BrowserbaseSessionClient(
        "bb_test",
        api=api,
        archive_loader=lambda: b"stagehand-extension",
    )

    with pytest.raises(RuntimeError, match="concurrency limit reached") as caught:
        await client.create_session(BrowserbaseBrowserSource(type="browserbase"))

    assert caught.value is create_error
    assert [request.extension_id for request in api.delete_requests] == ["ext_stagehand"]


@pytest.mark.asyncio
async def test_browserbase_session_cleanup_attempts_both_resources_and_retries_failures() -> None:
    api = FakeBrowserbaseAPI()
    release_error = RuntimeError("release failed")
    api.release_error = release_error
    client = BrowserbaseSessionClient(
        "bb_test",
        api=api,
        archive_loader=lambda: b"stagehand-extension",
    )
    session = await client.create_session(BrowserbaseBrowserSource(type="browserbase"))

    with pytest.raises(RuntimeError, match="release failed") as caught:
        await session.close()

    assert caught.value is release_error
    assert len(api.release_requests) == 1
    assert len(api.delete_requests) == 1

    api.release_error = None
    await session.close()

    assert len(api.release_requests) == 2
    assert len(api.delete_requests) == 1


def test_source_extension_archive_is_a_valid_stagehand_zip() -> None:
    archive = load_stagehand_extension_archive()

    with zipfile.ZipFile(BytesIO(archive)) as extension:
        assert "manifest.json" in extension.namelist()
