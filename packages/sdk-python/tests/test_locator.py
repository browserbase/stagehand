from __future__ import annotations

import os
from pathlib import Path
from typing import cast

import pytest

from stagehand._generated.models import (
    LocatorClickParams,
    LocatorClickResult,
    LocatorCountResult,
    LocatorDescriptor,
    LocatorInputValueResult,
    LocatorIsCheckedResult,
    LocatorSetInputFilesParams,
    LocatorSetInputFilesResult,
)
from stagehand.file_upload import FileInput, FilePayload
from stagehand.locator import Locator
from stagehand.rpc_client import RPCClient

from ._support import RecordingRPCClient


@pytest.mark.asyncio
async def test_locator_methods_use_generated_models_and_keep_the_descriptor_internal() -> None:
    recording = RecordingRPCClient({
        "locator.click": LocatorClickResult(clicked=True),
        "locator.count": 2,
        "locator.select_option": ["one"],
    })
    locator = Locator(
        cast(RPCClient, recording),
        page_id="page-1",
        selector="select",
    ).nth(1)

    await locator.click(button="left", click_count=2)
    count = await locator.count()
    selected = await locator.select_option("one")

    assert count == 2
    assert selected == ["one"]
    method, params, result_model = recording.calls[0]
    assert method == "locator.click"
    assert params == LocatorClickParams.model_validate({
        "page_id": "page-1",
        "selector": "select",
        "nth": 1,
        "options": {"button": "left", "click_count": 2},
    })
    assert result_model is LocatorClickResult
    assert recording.calls[1] == (
        "locator.count",
        LocatorDescriptor(page_id="page-1", selector="select", nth=1),
        LocatorCountResult,
    )


@pytest.mark.asyncio
async def test_locator_boolean_and_string_getters_return_scalars() -> None:
    recording = RecordingRPCClient({
        "locator.is_checked": True,
        "locator.input_value": "selected",
    })
    locator = Locator(
        cast(RPCClient, recording),
        page_id="page-1",
        selector="select",
    )

    assert await locator.is_checked() is True
    assert await locator.input_value() == "selected"
    descriptor = LocatorDescriptor(page_id="page-1", selector="select")
    assert recording.calls == [
        ("locator.is_checked", descriptor, LocatorIsCheckedResult),
        ("locator.input_value", descriptor, LocatorInputValueResult),
    ]


def test_locator_first_and_nth_validate_the_generated_descriptor() -> None:
    recording = RecordingRPCClient()
    locator = Locator(cast(RPCClient, recording), page_id="page-1", selector="button")

    assert locator.first().nth_index == 0
    assert locator.nth(3).nth_index == 3

    with pytest.raises(ValueError):
        locator.nth(-1)


@pytest.mark.asyncio
async def test_set_input_files_reads_paths_and_can_clear(tmp_path: Path) -> None:
    file_path = tmp_path / "hello.txt"
    file_path.write_text("hello")
    historical_path = tmp_path / "historical.txt"
    historical_path.write_text("old")
    os.utime(historical_path, ns=(0, -1_000_000))
    recording = RecordingRPCClient({
        "locator.set_input_files": {"set": True},
    })
    locator = Locator(
        cast(RPCClient, recording),
        page_id="page-1",
        selector="#upload",
    )

    await locator.set_input_files(file_path)
    await locator.set_input_files([])
    await locator.set_input_files(historical_path)

    method, params, result_model = recording.calls[0]
    assert method == "locator.set_input_files"
    assert isinstance(params, LocatorSetInputFilesParams)
    assert params.files[0].name == "hello.txt"
    assert params.files[0].data == "aGVsbG8="
    assert params.files[0].last_modified is not None
    assert result_model is LocatorSetInputFilesResult
    assert recording.calls[1][1] == LocatorSetInputFilesParams(
        page_id="page-1",
        selector="#upload",
        files=[],
    )
    historical_params = recording.calls[2][1]
    assert isinstance(historical_params, LocatorSetInputFilesParams)
    assert historical_params.files[0].model_dump(exclude_unset=True) == {
        "name": "historical.txt",
        "data": "b2xk",
    }


@pytest.mark.asyncio
async def test_set_input_files_normalizes_payloads_and_rejects_invalid_inputs(
    tmp_path: Path,
) -> None:
    recording = RecordingRPCClient({
        "locator.set_input_files": {"set": True},
    })
    locator = Locator(
        cast(RPCClient, recording),
        page_id="page-1",
        selector="#upload",
    )

    await locator.set_input_files([
        FilePayload(
            name="bytes.bin",
            buffer=bytes([0, 127, 255]),
            mime_type="application/octet-stream",
            last_modified=42,
        ),
        FilePayload(name="message.txt", buffer="hello"),
    ])

    params = recording.calls[0][1]
    assert isinstance(params, LocatorSetInputFilesParams)
    assert params.files[0].model_dump(exclude_unset=True) == {
        "name": "bytes.bin",
        "mime_type": "application/octet-stream",
        "data": "AH//",
        "last_modified": 42,
    }
    assert params.files[1].model_dump(exclude_unset=True) == {
        "name": "message.txt",
        "data": "aGVsbG8=",
    }

    with pytest.raises(ValueError, match="expected a readable file"):
        await locator.set_input_files(tmp_path / "missing.txt")
    with pytest.raises(ValueError, match="file payload name cannot be empty"):
        await locator.set_input_files(FilePayload(name="", buffer=b"hello"))
    with pytest.raises(ValueError, match="expected a path or FilePayload"):
        await locator.set_input_files([cast(FileInput, object())])

    oversized_path = tmp_path / "oversized.bin"
    with oversized_path.open("wb") as file:
        file.truncate(50 * 1024 * 1024 + 1)
    with pytest.raises(ValueError, match="larger than the 50 MiB upload limit"):
        await locator.set_input_files(oversized_path)
