from typing import Literal, cast

import pytest
from pydantic import JsonValue, ValidationError

from stagehand import Page
from stagehand._generated.models import (
    PageRef,
    PageWaitForFunctionOptions,
    PageWaitForFunctionParams,
    PageWaitForFunctionResult,
)
from stagehand.rpc_client import RPCClient, _rpc_response_timeout_seconds

from ._support import RecordingRPCClient


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "value",
    [True, "ready", 42, {"camelCase": {"snake_case": [True, None, 3]}}, [1, "ready"], None],
)
async def test_wait_for_function_preserves_json_results(value: JsonValue) -> None:
    rpc = RecordingRPCClient({"page.wait_for_function": {"value": value}})
    page = Page(cast(RPCClient, rpc), PageRef(page_id="page-1"))

    assert await page.wait_for_function("window.app") == value
    assert rpc.calls == [
        (
            "page.wait_for_function",
            PageWaitForFunctionParams(page_id="page-1", expression="window.app"),
            PageWaitForFunctionResult,
        )
    ]
    assert rpc.calls[0][1].model_dump(by_alias=True, exclude_unset=True) == {
        "page_id": "page-1",
        "expression": "window.app",
    }


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("polling", "timeout", "expected"),
    [
        (None, None, None),
        ("raf", None, {"polling": "raf"}),
        (12.5, 0, {"polling": 12.5, "timeout": 0}),
        (None, 45_000, {"timeout": 45_000}),
    ],
)
async def test_wait_for_function_forwards_only_supplied_options(
    polling: Literal["raf"] | float | None,
    timeout: int | None,
    expected: dict[str, str | float | int] | None,
) -> None:
    rpc = RecordingRPCClient({"page.wait_for_function": {"value": True}})
    page = Page(cast(RPCClient, rpc), PageRef(page_id="page-1"))

    await page.wait_for_function("window.ready", polling=polling, timeout=timeout)

    params = rpc.calls[0][1].model_dump(by_alias=True, exclude_unset=True)
    if expected is None:
        assert "options" not in params
    else:
        assert params["options"] == expected


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("arg", "parsed"),
    [
        ({"css": ".foo"}, 'JSON.parse("{\\"css\\": \\".foo\\"}")'),
        (None, 'JSON.parse("null")'),
        ({"__proto__": {"ok": True}}, 'JSON.parse("{\\"__proto__\\": {\\"ok\\": true}}")'),
    ],
)
async def test_wait_for_function_binds_arg_for_function_expressions(
    arg: JsonValue, parsed: str
) -> None:
    rpc = RecordingRPCClient({"page.wait_for_function": {"value": True}})
    page = Page(cast(RPCClient, rpc), PageRef(page_id="page-1"))

    await page.wait_for_function("window.count++, selector => !!selector", arg=arg)

    params = cast(PageWaitForFunctionParams, rpc.calls[0][1])
    assert params.expression == (
        f'((value) => typeof value === "function" ? () => value({parsed}) : value)'
        "((window.count++, selector => !!selector))"
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("arg", [float("nan"), object()])
async def test_wait_for_function_rejects_non_json_arg_before_rpc(arg: object) -> None:
    rpc = RecordingRPCClient()
    page = Page(cast(RPCClient, rpc), PageRef(page_id="page-1"))

    with pytest.raises(TypeError, match="'arg' must be JSON-serializable"):
        await page.wait_for_function("x => x", arg=cast(JsonValue, arg))
    assert not rpc.calls


@pytest.mark.asyncio
@pytest.mark.parametrize("polling", [0, -1, float("inf"), float("nan"), 2_147_483_648])
async def test_wait_for_function_rejects_invalid_polling_before_rpc(polling: float) -> None:
    rpc = RecordingRPCClient()
    page = Page(cast(RPCClient, rpc), PageRef(page_id="page-1"))

    with pytest.raises(ValidationError):
        await page.wait_for_function("true", polling=polling)
    assert not rpc.calls


@pytest.mark.asyncio
async def test_wait_for_function_preserves_remote_errors() -> None:
    error = RuntimeError("predicate failed")
    rpc = RecordingRPCClient({"page.wait_for_function": error})
    page = Page(cast(RPCClient, rpc), PageRef(page_id="page-1"))

    with pytest.raises(RuntimeError) as caught:
        await page.wait_for_function("predicate()")
    assert caught.value is error


@pytest.mark.parametrize("timeout,expected", [(None, None), (250, 10.25), (45_000, 55), (0, None)])
def test_wait_for_function_response_deadline(timeout: int | None, expected: float | None) -> None:
    params = PageWaitForFunctionParams(page_id="page-1", expression="true")
    if timeout is not None:
        params.options = PageWaitForFunctionOptions(timeout=timeout)

    assert _rpc_response_timeout_seconds("page.wait_for_function", params) == expected
