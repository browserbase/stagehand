from __future__ import annotations

import asyncio
import gc
import json
from collections.abc import Awaitable, Callable
from contextlib import suppress
from dataclasses import dataclass, field
from typing import Any, Literal, NoReturn, TypeVar, cast
from unittest.mock import patch

import httpx
import pytest
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st
from hypothesis.stateful import Bundle, RuleBasedStateMachine, invariant, precondition, rule
from pydantic import BaseModel, ConfigDict, ValidationError
from typing_extensions import override

from stagehand import browserbase_rpc, rpc_client
from stagehand._generated import models
from stagehand.browserbase_connection import BrowserbaseConnection
from stagehand.browserbase_rpc import register_browserbase_transport
from stagehand.cdp_client import (
    STAGEHAND_SEND_TO_HOST_BINDING,
    CDPClient,
    CDPConnectionClosedError,
    _CDPCommandError,
)
from stagehand.rpc_client import RPCClient, RPCError, RPCRequestContext

JSON = dict[str, object]
_T = TypeVar("_T")


class _EchoParams(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    value: int = 0


class _EchoResult(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    ok: bool
    value: int = 0


class _NoteParams(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    seq: int


class _LoopExceptionRecorder:
    def __init__(self, loop: asyncio.AbstractEventLoop) -> None:
        self._loop = loop
        self.exceptions: list[dict[str, Any]] = []
        self._previous = loop.get_exception_handler()
        loop.set_exception_handler(self._handle)

    def _handle(self, loop: asyncio.AbstractEventLoop, context: dict[str, Any]) -> None:
        self.exceptions.append(context)

    def assert_clean(self) -> None:
        gc.collect()
        assert self.exceptions == [], f"Unhandled asyncio loop exceptions: {self.exceptions!r}"

    def restore(self) -> None:
        self._loop.set_exception_handler(self._previous)


class _AdversarialRPCTransport:
    web_socket_debugger_url = "ws://127.0.0.1/devtools/browser/test"

    def __init__(self) -> None:
        self.incoming: asyncio.Queue[object] = asyncio.Queue()
        self.sent: list[JSON] = []
        self.closed = False
        self.close_count = 0
        self.fail_next_send: Literal["none", "sync", "async", "async_after_close"] = "none"
        self.send_gate: asyncio.Event | None = None
        self.close_gate: asyncio.Event | None = None
        self.close_started = asyncio.Event()
        self.fail_on_close = False

    async def send(self, message: JSON) -> None:
        mode = self.fail_next_send
        self.fail_next_send = "none"
        if mode == "sync":
            raise ConnectionError("sync transport send failure")
        if mode == "async":
            await asyncio.sleep(0)
            raise ConnectionError("async transport send failure")
        if self.send_gate is not None:
            gate = self.send_gate
            self.send_gate = None
            await gate.wait()
            if mode == "async_after_close":
                raise ConnectionError("send failed after close")
        self.sent.append(message)

    async def receive(self) -> object:
        item = await self.incoming.get()
        if isinstance(item, BaseException):
            raise item
        return item

    async def close(self) -> None:
        self.close_started.set()
        if self.close_gate is not None:
            await self.close_gate.wait()
        self.closed = True
        self.close_count += 1
        if self.fail_on_close:
            raise RuntimeError("transport close failed")


async def _drain(ticks: int = 4) -> None:
    for _ in range(ticks):
        await asyncio.sleep(0)


@dataclass
class _TrackedSend:
    task: asyncio.Task[object]
    request_id: int | None = None
    expected_result: int | None = None
    settled_outcomes: list[str] = field(default_factory=list)


class RPCClientStateMachine(RuleBasedStateMachine):
    requests = Bundle("requests")

    def __init__(self) -> None:
        super().__init__()
        self._loop = asyncio.new_event_loop()
        asyncio.set_event_loop(self._loop)
        self._recorder = _LoopExceptionRecorder(self._loop)
        self._transport = _AdversarialRPCTransport()
        self._client = self._run(self._make_client())
        self._inflight: dict[int, _TrackedSend] = {}
        self._completed_ids: set[int] = set()
        self._reverse_id = 10_000
        self._note_seq = 0
        self._received_notes: list[int] = []
        self._note_remover: Callable[[], None] | None = None
        self._handler_remover: Callable[[], None] | None = None
        self._handler_mode: Literal["ok", "raise", "bad_result"] = "ok"
        self._buffered_expected: list[int] = []

    async def _make_client(self) -> RPCClient:
        return RPCClient(self._transport)

    def _run(self, coro: Awaitable[_T]) -> _T:
        return self._loop.run_until_complete(coro)

    @override
    def teardown(self) -> None:
        async def _cleanup() -> None:
            with suppress(Exception):
                await self._client.close()
            for tracked in self._inflight.values():
                if not tracked.task.done():
                    tracked.task.cancel()
                with suppress(BaseException):
                    await tracked.task
            await _drain(6)

        try:
            self._run(_cleanup())
            assert self._client._closed is True
            assert self._client._pending == {}
            assert self._client._request_handlers == {}
            assert self._client._notification_listeners == {}
            assert self._client._pending_notifications == []
            assert self._client._inbound_tasks == set()
            assert self._client._close_listeners == {}
            assert self._client._reader.done()
            self._recorder.assert_clean()
        finally:
            self._recorder.restore()
            self._loop.close()
            asyncio.set_event_loop(None)

    @rule(
        target=requests,
        value=st.integers(min_value=-1000, max_value=1000),
        fail_mode=st.sampled_from(["none", "none", "none", "sync", "async"]),
    )
    def start_send(
        self,
        value: int,
        fail_mode: Literal["none", "sync", "async"],
    ) -> int:
        if self._client._closed:
            with pytest.raises(RuntimeError, match="RPC client is closed"):
                self._run(self._client.send("test.echo", _EchoParams(value=value), _EchoResult))
            return -1

        expected_id = self._client._next_request_id
        self._transport.fail_next_send = fail_mode

        async def _launch() -> _TrackedSend:
            task: asyncio.Task[object] = asyncio.create_task(
                self._client.send("test.echo", _EchoParams(value=value), _EchoResult)
            )
            await _drain(2)
            return _TrackedSend(task=task, request_id=expected_id)

        tracked = self._run(_launch())
        if fail_mode in ("sync", "async"):
            assert tracked.task.done()
            with pytest.raises(ConnectionError):
                tracked.task.result()
            self._completed_ids.add(expected_id)
            return -1

        self._inflight[expected_id] = tracked
        return expected_id

    @precondition(lambda self: bool(self._inflight) and not self._client._closed)
    @rule(
        request_id=requests,
        kind=st.sampled_from(["ok", "rpc_error", "invalid_result"]),
        value=st.integers(min_value=-500, max_value=500),
    )
    def deliver_response(
        self,
        request_id: int,
        kind: Literal["ok", "rpc_error", "invalid_result"],
        value: int,
    ) -> None:
        if request_id < 0:
            return
        already_completed = request_id in self._completed_ids
        tracked = self._inflight.get(request_id)

        payload: JSON
        if kind == "ok":
            payload = {
                "jsonrpc": "2.0",
                "id": request_id,
                "result": {"ok": True, "value": value},
            }
        elif kind == "rpc_error":
            payload = {
                "jsonrpc": "2.0",
                "id": request_id,
                "error": {"code": -32001, "message": "boom", "data": {"v": value}},
            }
        else:
            payload = {
                "jsonrpc": "2.0",
                "id": request_id,
                "result": {"ok": "not-a-bool"},
            }

        async def _deliver() -> None:
            await self._transport.incoming.put(payload)
            await _drain(4)

        self._run(_deliver())

        if tracked is not None and not already_completed:
            assert tracked.task.done()
            if kind == "ok":
                assert tracked.task.result() == _EchoResult(ok=True, value=value)
            elif kind == "rpc_error":
                with pytest.raises(RPCError, match="boom") as exc:
                    tracked.task.result()
                assert exc.value.code == -32001
            else:
                with pytest.raises(ValidationError):
                    tracked.task.result()
            self._inflight.pop(request_id, None)
            self._completed_ids.add(request_id)
            assert request_id not in self._client._pending

    @rule(
        unknown_id=st.one_of(st.none(), st.integers(min_value=500_000, max_value=999_999)),
        is_error=st.booleans(),
    )
    def deliver_unknown_or_null_response(self, unknown_id: int | None, is_error: bool) -> None:
        if self._client._closed:
            return
        if unknown_id is None and not is_error:
            return
        message: JSON = (
            {
                "jsonrpc": "2.0",
                "id": unknown_id,
                "error": {"code": -32603, "message": "unsolicited"},
            }
            if is_error
            else {"jsonrpc": "2.0", "id": unknown_id, "result": {"ok": True}}
        )
        self._run(self._transport.incoming.put(message))
        self._run(_drain(3))
        assert not self._client._closed

    @precondition(lambda self: bool(self._inflight))
    @rule(request_id=requests)
    def cancel_request(self, request_id: int) -> None:
        tracked = self._inflight.pop(request_id, None)
        if tracked is None:
            return

        async def _cancel() -> None:
            tracked.task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await tracked.task
            await _drain(2)

        self._run(_cancel())
        self._completed_ids.add(request_id)
        assert request_id not in self._client._pending

    @rule(mode=st.sampled_from(["ok", "raise", "bad_result", "unregister"]))
    def configure_reverse_handler(
        self, mode: Literal["ok", "raise", "bad_result", "unregister"]
    ) -> None:
        if self._client._closed:
            return
        if mode == "unregister":
            if self._handler_remover is not None:
                self._handler_remover()
                self._handler_remover = None
            return
        self._handler_mode = mode

        def handle(params: _EchoParams, _ctx: RPCRequestContext) -> _EchoResult:
            if self._handler_mode == "raise":
                raise KeyError(f"failed-{params.value}")
            if self._handler_mode == "bad_result":
                return cast(_EchoResult, {"wrong": True})
            return _EchoResult(ok=True, value=params.value + 1)

        self._handler_remover = self._client.on_request_with_context(
            "reverse.echo", _EchoParams, _EchoResult, handle
        )

    @rule(
        valid_params=st.booleans(),
        value=st.integers(min_value=-100, max_value=100),
    )
    def deliver_reverse_request(self, valid_params: bool, value: int) -> None:
        if self._client._closed:
            return
        req_id = self._reverse_id
        self._reverse_id += 1
        before = len(self._transport.sent)
        self._run(
            self._transport.incoming.put({
                "jsonrpc": "2.0",
                "id": req_id,
                "method": "reverse.echo",
                "params": {"value": value} if valid_params else {"value": "bad"},
            })
        )
        self._run(_drain(5))
        replies = [m for m in self._transport.sent[before:] if m.get("id") == req_id]
        assert len(replies) == 1
        reply = replies[0]
        if self._handler_remover is None:
            assert cast(JSON, reply["error"])["code"] == -32601
        elif not valid_params:
            assert cast(JSON, reply["error"])["code"] == -32602
        elif self._handler_mode == "ok":
            assert reply["result"] == {"ok": True, "value": value + 1}
        else:
            assert cast(JSON, reply["error"])["code"] == -32603

    @rule(count=st.integers(min_value=1, max_value=30))
    def deliver_notifications(self, count: int) -> None:
        if self._client._closed:
            return

        async def _send_notes() -> None:
            for _ in range(count):
                self._note_seq += 1
                seq = self._note_seq
                if self._note_remover is None:
                    self._buffered_expected.append(seq)
                    if len(self._buffered_expected) > 100:
                        self._buffered_expected.pop(0)
                await self._transport.incoming.put({
                    "jsonrpc": "2.0",
                    "method": "test.note",
                    "params": {"seq": seq},
                })
            await _drain(6)

        self._run(_send_notes())

    @rule(register=st.booleans())
    def toggle_notification_listener(self, register: bool) -> None:
        if self._client._closed:
            return
        if register and self._note_remover is None:
            expected_flushed = list(self._buffered_expected)
            self._buffered_expected.clear()

            def listener(params: _NoteParams) -> None:
                self._received_notes.append(params.seq)

            async def _register() -> Callable[[], None]:
                remover = self._client.on_notification("test.note", _NoteParams, listener)
                await _drain(5)
                return remover

            self._note_remover = self._run(_register())
            if expected_flushed:
                assert self._received_notes[-len(expected_flushed) :] == expected_flushed
        elif not register and self._note_remover is not None:
            self._note_remover()
            self._note_remover = None

    @rule(close_mode=st.sampled_from(["close", "detach", "disconnect"]))
    def close_or_disconnect(self, close_mode: Literal["close", "detach", "disconnect"]) -> None:
        if self._client._closed:
            self._run(self._client.close())
            return

        async def _do_close() -> None:
            if close_mode == "disconnect":
                await self._transport.incoming.put(ConnectionResetError("peer reset"))
                await _drain(8)
            else:
                await self._client.close(close_transport=(close_mode == "close"))
            for req_id, tracked in list(self._inflight.items()):
                assert tracked.task.done()
                with pytest.raises(Exception):
                    tracked.task.result()
                self._inflight.pop(req_id)
                self._completed_ids.add(req_id)

        self._run(_do_close())

    @invariant()
    def verify_invariants(self) -> None:
        assert len(self._client._pending_notifications) <= 100
        assert set(self._client._pending.keys()).issubset(set(self._inflight.keys()))
        if self._client._closed:
            assert self._client._pending == {}
            assert self._client._pending_notifications == []
            assert self._client._request_handlers == {}
            assert self._client._notification_listeners == {}
            assert self._client._inbound_tasks == set()
        self._recorder.assert_clean()


TestRPCClientStateful = RPCClientStateMachine.TestCase
TestRPCClientStateful.settings = settings(
    max_examples=35,
    stateful_step_count=25,
    deadline=None,
    suppress_health_check=[HealthCheck.too_slow],
)


@pytest.mark.asyncio
@settings(max_examples=40, deadline=None)
@given(
    n_requests=st.integers(min_value=1, max_value=12),
    outcomes=st.lists(
        st.sampled_from(["ok", "error", "cancel", "dup_ok", "dup_error"]),
        min_size=12,
        max_size=12,
    ),
    data=st.data(),
)
async def test_rpc_concurrent_interleavings_single_settlement_and_no_leaks(
    n_requests: int,
    outcomes: list[str],
    data: st.DataObject,
) -> None:
    loop = asyncio.get_running_loop()
    recorder = _LoopExceptionRecorder(loop)
    transport = _AdversarialRPCTransport()
    client = RPCClient(transport)
    try:
        tasks: dict[int, asyncio.Task[_EchoResult]] = {}
        for i in range(n_requests):
            task = asyncio.create_task(client.send("test.echo", _EchoParams(value=i), _EchoResult))
            await _drain(2)
            req_id = cast(int, transport.sent[-1]["id"])
            tasks[req_id] = task
        assert len(transport.sent) == n_requests

        order = data.draw(st.permutations(list(tasks.keys())))
        for idx, req_id in enumerate(order):
            action = outcomes[idx]
            task = tasks[req_id]
            if action == "cancel":
                task.cancel()
                with pytest.raises(asyncio.CancelledError):
                    await task
                await transport.incoming.put({
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "result": {"ok": True, "value": 999},
                })
                await _drain(2)
            elif action in ("ok", "dup_ok"):
                await transport.incoming.put({
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "result": {"ok": True, "value": req_id},
                })
                if action == "dup_ok":
                    await transport.incoming.put({
                        "jsonrpc": "2.0",
                        "id": req_id,
                        "result": {"ok": True, "value": req_id + 10_000},
                    })
                    await transport.incoming.put({
                        "jsonrpc": "2.0",
                        "id": req_id,
                        "error": {"code": -32000, "message": "late duplicate error"},
                    })
                result = await asyncio.wait_for(task, timeout=1)
                assert result == _EchoResult(ok=True, value=req_id)
            else:
                await transport.incoming.put({
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "error": {"code": -32002, "message": f"err-{req_id}"},
                })
                if action == "dup_error":
                    await transport.incoming.put({
                        "jsonrpc": "2.0",
                        "id": req_id,
                        "result": {"ok": True, "value": req_id},
                    })
                with pytest.raises(RPCError, match=f"err-{req_id}"):
                    await asyncio.wait_for(task, timeout=1)

        await _drain(3)
        assert client._pending == {}
        assert not client._closed
    finally:
        await client.close()
        for task in tasks.values():
            if not task.done():
                task.cancel()
        if tasks:
            await asyncio.gather(*tasks.values(), return_exceptions=True)
        await _drain(4)
        recorder.assert_clean()
        recorder.restore()


@pytest.mark.asyncio
async def test_rpc_timeout_and_late_reply_leaves_no_leaks_or_unhandled_exceptions(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(rpc_client, "_RPC_RESPONSE_GRACE_MS", 15)
    loop = asyncio.get_running_loop()
    recorder = _LoopExceptionRecorder(loop)
    transport = _AdversarialRPCTransport()
    client = RPCClient(transport)
    try:
        with pytest.raises(TimeoutError, match=r"RPC response timed out after 0\.015s: test\.slow"):
            await client.send("test.slow", _EchoParams(value=1), _EchoResult)
        assert client._pending == {}
        timed_out_id = cast(int, transport.sent[-1]["id"])

        await transport.incoming.put({
            "jsonrpc": "2.0",
            "id": timed_out_id,
            "result": {"ok": True, "value": 999},
        })
        await transport.incoming.put({
            "jsonrpc": "2.0",
            "id": timed_out_id,
            "error": {"code": -32603, "message": "late error after timeout"},
        })
        await _drain(4)
        assert not client._closed
        assert client._pending == {}

        followup = asyncio.create_task(client.send("test.echo", _EchoParams(value=2), _EchoResult))
        await _drain(2)
        next_id = cast(int, transport.sent[-1]["id"])
        await transport.incoming.put({
            "jsonrpc": "2.0",
            "id": next_id,
            "result": {"ok": True, "value": 42},
        })
        assert await asyncio.wait_for(followup, timeout=1) == _EchoResult(ok=True, value=42)
        assert client._pending == {}
    finally:
        await client.close()
        await _drain(4)
        recorder.assert_clean()
        recorder.restore()


@pytest.mark.asyncio
async def test_rpc_non_async_sync_raising_send_leaves_no_pending_leak() -> None:
    loop = asyncio.get_running_loop()
    recorder = _LoopExceptionRecorder(loop)

    class _SyncRaisingTransport(_AdversarialRPCTransport):
        @override
        def send(self, message: JSON) -> NoReturn:
            raise ConnectionError("raised before returning coroutine")

    transport = _SyncRaisingTransport()
    client = RPCClient(transport)
    try:
        with pytest.raises(ConnectionError, match="raised before returning coroutine"):
            await client.send("test.echo", _EchoParams(value=1), _EchoResult)
        assert client._pending == {}
    finally:
        await client.close()
        await _drain(4)
        recorder.assert_clean()
        recorder.restore()


@pytest.mark.asyncio
async def test_rpc_send_failure_racing_with_close_leaves_no_unretrieved_future_exception() -> None:
    loop = asyncio.get_running_loop()
    recorder = _LoopExceptionRecorder(loop)

    async def _run_race() -> None:
        transport = _AdversarialRPCTransport()
        gate = asyncio.Event()
        transport.send_gate = gate
        transport.fail_next_send = "async_after_close"
        client = RPCClient(transport)
        try:
            send_task = asyncio.create_task(
                client.send("test.echo", _EchoParams(value=1), _EchoResult)
            )
            await _drain(3)
            assert len(client._pending) == 1

            close_task = asyncio.create_task(client.close(RuntimeError("closing during send")))
            await _drain(2)
            gate.set()
            with pytest.raises(ConnectionError, match="send failed after close"):
                await send_task
            await close_task
            assert client._pending == {}
        finally:
            await client.close()
            await _drain(4)

    try:
        await _run_race()
        recorder.assert_clean()
    finally:
        recorder.restore()


@pytest.mark.asyncio
async def test_rpc_concurrent_close_waits_for_inflight_close_completion() -> None:
    loop = asyncio.get_running_loop()
    recorder = _LoopExceptionRecorder(loop)
    transport = _AdversarialRPCTransport()
    close_gate = asyncio.Event()
    transport.close_gate = close_gate
    client = RPCClient(transport)
    try:
        first_close = asyncio.create_task(client.close())
        await _drain(3)
        assert not first_close.done()
        assert not transport.closed

        second_close = asyncio.create_task(client.close())
        await _drain(3)
        assert not second_close.done(), "second close() returned before transport finished closing"

        close_gate.set()
        await asyncio.wait_for(asyncio.gather(first_close, second_close), timeout=1)
        assert transport.closed
        assert transport.close_count == 1
    finally:
        close_gate.set()
        await client.close()
        await _drain(4)
        recorder.assert_clean()
        recorder.restore()


@pytest.mark.asyncio
async def test_rpc_on_close_listener_reentrant_close_does_not_deadlock() -> None:
    loop = asyncio.get_running_loop()
    recorder = _LoopExceptionRecorder(loop)
    transport = _AdversarialRPCTransport()
    client = RPCClient(transport)
    listener_entered = asyncio.Event()
    listener_release = asyncio.Event()
    reentrant_completed = False

    async def on_close_listener() -> None:
        nonlocal reentrant_completed
        listener_entered.set()
        await asyncio.wait_for(client.close(), timeout=1)
        await asyncio.wait_for(asyncio.create_task(client.close()), timeout=1)
        reentrant_completed = True
        await listener_release.wait()

    client.on_close(on_close_listener)
    try:
        first_close = asyncio.create_task(client.close())
        await asyncio.wait_for(listener_entered.wait(), timeout=1)
        await _drain(4)
        assert reentrant_completed

        independent_close = asyncio.create_task(client.close())
        await _drain(4)
        assert not independent_close.done()
        assert not transport.closed

        listener_release.set()
        await asyncio.wait_for(asyncio.gather(first_close, independent_close), timeout=1)
        assert transport.closed
        assert transport.close_count == 1
    finally:
        listener_release.set()
        await client.close()
        await _drain(4)
        recorder.assert_clean()
        recorder.restore()


@pytest.mark.asyncio
async def test_rpc_cancelled_close_caller_still_completes_cleanup_and_blocks_later_close() -> None:
    loop = asyncio.get_running_loop()
    recorder = _LoopExceptionRecorder(loop)
    transport = _AdversarialRPCTransport()
    close_gate = asyncio.Event()
    transport.close_gate = close_gate
    client = RPCClient(transport)
    listener_ran = False

    async def on_close_listener() -> None:
        nonlocal listener_ran
        listener_ran = True

    client.on_close(on_close_listener)
    try:
        first_close = asyncio.create_task(client.close())
        await asyncio.wait_for(transport.close_started.wait(), timeout=1)
        assert listener_ran
        assert not first_close.done()
        assert not transport.closed

        first_close.cancel()
        with pytest.raises(asyncio.CancelledError):
            await first_close
        assert not transport.closed

        second_close = asyncio.create_task(client.close())
        await _drain(4)
        assert not second_close.done()

        close_gate.set()
        await asyncio.wait_for(second_close, timeout=1)
        assert transport.closed
        assert transport.close_count == 1
    finally:
        close_gate.set()
        await client.close()
        await _drain(4)
        recorder.assert_clean()
        recorder.restore()


@pytest.mark.asyncio
async def test_rpc_receive_after_close_does_not_leak_notifications_or_tasks() -> None:
    loop = asyncio.get_running_loop()
    recorder = _LoopExceptionRecorder(loop)
    transport = _AdversarialRPCTransport()
    client = RPCClient(transport)
    await client.close()

    await client._receive({"jsonrpc": "2.0", "method": "late.note", "params": {}})
    await client._receive({"jsonrpc": "2.0", "id": 1, "method": "late.req", "params": {}})
    await _drain(3)
    assert client._pending_notifications == []
    assert client._inbound_tasks == set()
    recorder.assert_clean()
    recorder.restore()


@pytest.mark.asyncio
async def test_rpc_inbound_handler_failure_does_not_leave_unretrieved_close_task_exception() -> (
    None
):
    loop = asyncio.get_running_loop()
    recorder = _LoopExceptionRecorder(loop)
    transport = _AdversarialRPCTransport()
    transport.fail_on_close = True
    client = RPCClient(transport)

    async def boom_listener(_params: _NoteParams) -> None:
        raise RuntimeError("listener exploded")

    client.on_notification("boom.note", _NoteParams, boom_listener)
    await transport.incoming.put({
        "jsonrpc": "2.0",
        "method": "boom.note",
        "params": {"seq": 1},
    })
    await _drain(8)
    assert client._closed
    with suppress(RuntimeError):
        await client.close()
    await _drain(4)
    recorder.assert_clean()
    recorder.restore()


@pytest.mark.asyncio
@settings(max_examples=30, deadline=None)
@given(
    ops=st.lists(
        st.one_of(
            st.tuples(
                st.just("request"),
                st.integers(min_value=1, max_value=6),
                st.sampled_from(["fast", "slow", "unavailable"]),
            ),
            st.tuples(
                st.just("cancel"),
                st.integers(min_value=1, max_value=6),
                st.sampled_from(["cancelled", "timeout"]),
            ),
            st.tuples(st.just("release_one")),
            st.tuples(st.just("dispose")),
        ),
        min_size=3,
        max_size=20,
    ),
    close_at_end=st.sampled_from(["close", "dispose"]),
)
async def test_browserbase_rpc_stateful_interleavings(
    ops: list[tuple[Any, ...]],
    close_at_end: Literal["close", "dispose"],
) -> None:
    loop = asyncio.get_running_loop()
    recorder = _LoopExceptionRecorder(loop)
    gates: list[asyncio.Event] = []

    async def fake_execute(
        connection: BrowserbaseConnection | None,
        params: models.BrowserbaseRequestParams,
        *,
        http_client: httpx.AsyncClient | None = None,
    ) -> models.BrowserbaseRequestResult:
        if connection is None or params.body == "unavailable":
            return models.BrowserbaseRequestResult(
                root=models.BrowserbaseTransportError(
                    type="error", reason=models.Reason.unavailable, message="unavailable"
                )
            )
        if params.body == "slow":
            gate = asyncio.Event()
            gates.append(gate)
            await gate.wait()
        return models.BrowserbaseRequestResult(
            root=models.BrowserbaseHttpResponse(
                type="response", status=200, status_text="OK", headers={}, body="{}"
            )
        )

    transport = _AdversarialRPCTransport()
    client = RPCClient(transport)
    connection = BrowserbaseConnection("bb-key", "https://api.example/v1", "sess-1")
    with patch.object(browserbase_rpc, "execute_browserbase_request", fake_execute):
        dispose = register_browserbase_transport(client, connection)
        disposed = False

        try:
            sent_counts: dict[int, int] = {}
            for op in ops:
                kind = op[0]
                if kind == "request":
                    _, req_id, mode = op
                    sent_counts[req_id] = sent_counts.get(req_id, 0) + 1
                    await transport.incoming.put({
                        "jsonrpc": "2.0",
                        "id": req_id,
                        "method": "browserbase.request",
                        "params": {
                            "operation": "gateway.responses",
                            "headers": {},
                            "body": mode,
                        },
                    })
                    await _drain(4)
                elif kind == "cancel":
                    _, req_id, reason = op
                    await transport.incoming.put({
                        "jsonrpc": "2.0",
                        "method": "browserbase.cancel",
                        "params": {"request_id": req_id, "reason": reason},
                    })
                    await _drain(3)
                elif kind == "release_one":
                    if gates:
                        gates.pop(0).set()
                        await _drain(4)
                elif kind == "dispose":
                    disposed = True
                    await asyncio.gather(dispose(), dispose())
                    await _drain(3)

            for gate in gates:
                gate.set()
            await _drain(6)

            if close_at_end == "dispose":
                await dispose()
            else:
                await client.close()
            await _drain(4)

            replies_by_id: dict[int, int] = {}
            for msg in transport.sent:
                msg_id = msg.get("id")
                if isinstance(msg_id, int):
                    replies_by_id[msg_id] = replies_by_id.get(msg_id, 0) + 1
            for req_id, reply_count in replies_by_id.items():
                assert reply_count <= sent_counts.get(req_id, 0)
            if disposed:
                assert not client._inbound_tasks or client._closed
        finally:
            for gate in gates:
                gate.set()
            await client.close()
            await dispose()
            await _drain(4)
            recorder.assert_clean()
            recorder.restore()


class _AdversarialWebSocket:
    def __init__(self) -> None:
        self.incoming: asyncio.Queue[str | bytes | BaseException] = asyncio.Queue()
        self.sent: list[dict[str, object]] = []
        self.closed = False
        self.close_count = 0
        self.fail_next_send: Literal["none", "sync", "async", "async_after_close"] = "none"
        self.send_gate: asyncio.Event | None = None
        self.close_gate: asyncio.Event | None = None
        self.close_started = asyncio.Event()

    async def send(self, message: str) -> None:
        mode = self.fail_next_send
        self.fail_next_send = "none"
        if mode == "sync":
            raise RuntimeError("sync ws send failed")
        if mode == "async":
            await asyncio.sleep(0)
            raise RuntimeError("async ws send failed")
        if self.send_gate is not None:
            gate = self.send_gate
            self.send_gate = None
            await gate.wait()
            if mode == "async_after_close":
                raise RuntimeError("ws send failed after close")
        self.sent.append(cast(dict[str, object], json.loads(message)))

    async def recv(self) -> str | bytes:
        item = await self.incoming.get()
        if isinstance(item, BaseException):
            raise item
        return item

    async def close(self) -> None:
        self.close_started.set()
        if self.close_gate is not None:
            await self.close_gate.wait()
        self.closed = True
        self.close_count += 1


class CDPClientStateMachine(RuleBasedStateMachine):
    commands = Bundle("commands")

    def __init__(self) -> None:
        super().__init__()
        self._loop = asyncio.new_event_loop()
        asyncio.set_event_loop(self._loop)
        self._recorder = _LoopExceptionRecorder(self._loop)
        self._socket = _AdversarialWebSocket()
        self._sibling_socket = _AdversarialWebSocket()
        self._client = self._run(self._make_client(self._socket, "session-A"))
        self._sibling = self._run(self._make_client(self._sibling_socket, "session-B"))
        self._inflight: dict[int, asyncio.Task[dict[str, object]]] = {}
        self._completed: set[int] = set()
        self._expected_bindings: list[str] = []

    async def _make_client(
        self, socket: _AdversarialWebSocket, session_id: str | None
    ) -> CDPClient:
        client = CDPClient(socket, "ws://127.0.0.1/devtools/browser/test")
        client._session_id = session_id
        return client

    def _run(self, coro: Awaitable[_T]) -> _T:
        return self._loop.run_until_complete(coro)

    @override
    def teardown(self) -> None:
        async def _cleanup() -> None:
            await self._client.close()
            await self._sibling.close()
            for task in self._inflight.values():
                if not task.done():
                    task.cancel()
                with suppress(BaseException):
                    await task
            await _drain(6)

        try:
            self._run(_cleanup())
            assert self._client.closed
            assert self._client._pending == {}
            assert self._client._background_tasks == set()
            assert self._client._reader.done()
            assert self._sibling.closed
            assert self._sibling._pending == {}
            self._recorder.assert_clean()
        finally:
            self._recorder.restore()
            self._loop.close()
            asyncio.set_event_loop(None)

    @rule(
        target=commands,
        fail_mode=st.sampled_from(["none", "none", "none", "sync", "async"]),
        session_id=st.sampled_from([None, "session-A"]),
    )
    def send_command(
        self,
        fail_mode: Literal["none", "sync", "async"],
        session_id: str | None,
    ) -> int:
        if self._client.closed:
            with pytest.raises(RuntimeError, match="CDP client is closed"):
                self._run(self._client.send_command("Runtime.evaluate", {}, session_id=session_id))
            return -1

        cmd_id = self._client._next_id
        self._socket.fail_next_send = fail_mode

        async def _launch() -> asyncio.Task[dict[str, object]]:
            task = asyncio.create_task(
                self._client.send_command("Runtime.evaluate", {"n": cmd_id}, session_id=session_id)
            )
            await _drain(2)
            return task

        task = self._run(_launch())
        if fail_mode in ("sync", "async"):
            assert task.done()
            with pytest.raises(RuntimeError):
                task.result()
            self._completed.add(cmd_id)
            return -1

        self._inflight[cmd_id] = task
        return cmd_id

    @precondition(lambda self: bool(self._inflight) and not self._client.closed)
    @rule(
        cmd_id=commands,
        kind=st.sampled_from(["ok", "error", "none_result", "invalid_result"]),
    )
    def deliver_cdp_response(
        self,
        cmd_id: int,
        kind: Literal["ok", "error", "none_result", "invalid_result"],
    ) -> None:
        if cmd_id < 0:
            return
        already_completed = cmd_id in self._completed
        task = self._inflight.get(cmd_id)

        msg: dict[str, object]
        if kind == "ok":
            msg = {"id": cmd_id, "result": {"ok": cmd_id}}
        elif kind == "error":
            msg = {"id": cmd_id, "error": {"code": -32000, "message": "cdp failed"}}
        elif kind == "none_result":
            msg = {"id": cmd_id}
        else:
            msg = {"id": cmd_id, "result": "not-a-dict"}

        self._run(self._socket.incoming.put(json.dumps(msg)))
        self._run(_drain(4))

        if task is not None and not already_completed:
            assert task.done()
            if kind == "ok":
                assert task.result() == {"ok": cmd_id}
            elif kind == "none_result":
                assert task.result() == {}
            elif kind == "error":
                with pytest.raises(_CDPCommandError):
                    task.result()
            else:
                with pytest.raises(RuntimeError, match="invalid result"):
                    task.result()
            self._inflight.pop(cmd_id, None)
            self._completed.add(cmd_id)
            assert cmd_id not in self._client._pending

    @precondition(lambda self: bool(self._inflight))
    @rule(cmd_id=commands)
    def cancel_command(self, cmd_id: int) -> None:
        task = self._inflight.pop(cmd_id, None)
        if task is None:
            return

        async def _cancel() -> None:
            task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await task
            await _drain(2)

        self._run(_cancel())
        self._completed.add(cmd_id)
        assert cmd_id not in self._client._pending

    @rule(
        event_session=st.sampled_from(["session-A", "session-B", None]),
        payload=st.text(min_size=1, max_size=20),
    )
    def deliver_binding_event(self, event_session: str | None, payload: str) -> None:
        if self._client.closed:
            return
        event: dict[str, object] = {
            "method": "Runtime.bindingCalled",
            "params": {
                "name": STAGEHAND_SEND_TO_HOST_BINDING,
                "payload": payload,
                "executionContextId": 1,
            },
        }
        if event_session is not None:
            event["sessionId"] = event_session
        self._run(self._socket.incoming.put(json.dumps(event)))
        self._run(_drain(3))
        if event_session == "session-A":
            self._expected_bindings.append(payload)
            received = self._run(asyncio.wait_for(self._client.receive(), timeout=1))
            assert received == self._expected_bindings.pop(0)
        else:
            assert self._client._incoming.empty()

    @rule(
        unknown_id=st.one_of(st.booleans(), st.integers(min_value=900_000, max_value=999_999)),
    )
    def deliver_unknown_or_bool_id(self, unknown_id: bool | int) -> None:
        if self._client.closed:
            return
        self._run(self._socket.incoming.put(json.dumps({"id": unknown_id, "result": {}})))
        self._run(_drain(3))
        assert not self._client.closed
        assert all(not task.done() for task in self._inflight.values())
        assert set(self._inflight).issubset(self._client._pending)

    @rule()
    def schedule_background_command(self) -> None:
        if self._client.closed:
            return

        async def _schedule() -> None:
            self._client._schedule_best_effort_command("Target.closeTarget", {"targetId": "bg-1"})
            await _drain(2)

        self._run(_schedule())

    @rule(mode=st.sampled_from(["close", "disconnect"]))
    def close_primary_leaving_sibling_alive(self, mode: Literal["close", "disconnect"]) -> None:
        if self._client.closed:
            return

        async def _close() -> None:
            if mode == "disconnect":
                await self._socket.incoming.put(ConnectionResetError("ws dropped"))
                await _drain(6)
            else:
                await self._client.close()
            for cmd_id, task in list(self._inflight.items()):
                assert task.done()
                with pytest.raises(Exception):
                    task.result()
                self._inflight.pop(cmd_id)
                self._completed.add(cmd_id)

        self._run(_close())
        assert self._client.closed
        assert not self._sibling.closed

        async def _verify_sibling_isolated() -> None:
            sib_id = self._sibling._next_id
            sib_task = asyncio.create_task(
                self._sibling.send_command("Runtime.evaluate", {}, session_id="session-B")
            )
            await _drain(2)
            await self._sibling_socket.incoming.put(
                json.dumps({"id": sib_id, "result": {"alive": True}})
            )
            assert await asyncio.wait_for(sib_task, timeout=1) == {"alive": True}

        self._run(_verify_sibling_isolated())

    @invariant()
    def verify_invariants(self) -> None:
        if self._client.closed:
            assert self._client._pending == {}
            assert self._client._background_tasks == set()
        self._recorder.assert_clean()


TestCDPClientStateful = CDPClientStateMachine.TestCase
TestCDPClientStateful.settings = settings(
    max_examples=35,
    stateful_step_count=25,
    deadline=None,
    suppress_health_check=[HealthCheck.too_slow],
)


@pytest.mark.asyncio
async def test_cdp_unattached_client_ignores_sessionless_binding_events() -> None:
    loop = asyncio.get_running_loop()
    recorder = _LoopExceptionRecorder(loop)
    socket = _AdversarialWebSocket()
    client = CDPClient(socket, "ws://127.0.0.1/devtools/browser/test")
    try:
        assert client._session_id is None
        await socket.incoming.put(
            json.dumps({
                "method": "Runtime.bindingCalled",
                "params": {
                    "name": STAGEHAND_SEND_TO_HOST_BINDING,
                    "payload": "rogue-sessionless-payload",
                    "executionContextId": 1,
                },
            })
        )
        await _drain(4)
        assert client._incoming.empty(), (
            "unattached CDPClient accepted Runtime.bindingCalled without sessionId"
        )
    finally:
        await client.close()
        await _drain(4)
        recorder.assert_clean()
        recorder.restore()


@pytest.mark.asyncio
async def test_cdp_receive_called_repeatedly_after_close_never_hangs() -> None:
    loop = asyncio.get_running_loop()
    recorder = _LoopExceptionRecorder(loop)
    socket = _AdversarialWebSocket()
    client = CDPClient(socket, "ws://127.0.0.1/devtools/browser/test")
    await client.close()

    with pytest.raises(RuntimeError, match="CDP client closed"):
        await asyncio.wait_for(client.receive(), timeout=0.5)
    with pytest.raises(RuntimeError, match="CDP client closed"):
        await asyncio.wait_for(client.receive(), timeout=0.5)

    recorder.assert_clean()
    recorder.restore()


@pytest.mark.asyncio
async def test_cdp_send_failure_racing_with_close_leaves_no_unretrieved_future_exception() -> None:
    loop = asyncio.get_running_loop()
    recorder = _LoopExceptionRecorder(loop)

    async def _run_race() -> None:
        socket = _AdversarialWebSocket()
        gate = asyncio.Event()
        socket.send_gate = gate
        socket.fail_next_send = "async_after_close"
        client = CDPClient(socket, "ws://127.0.0.1/devtools/browser/test")
        try:
            cmd = asyncio.create_task(client.send_command("Runtime.evaluate", {}))
            await _drain(3)
            assert len(client._pending) == 1

            close_task = asyncio.create_task(client.close())
            await _drain(2)
            gate.set()
            with pytest.raises(RuntimeError, match="ws send failed after close"):
                await cmd
            await close_task
            assert client._pending == {}
        finally:
            await client.close()
            await _drain(4)

    try:
        await _run_race()
        recorder.assert_clean()
    finally:
        recorder.restore()


@pytest.mark.asyncio
async def test_cdp_close_cancels_and_cleans_background_tasks() -> None:
    loop = asyncio.get_running_loop()
    recorder = _LoopExceptionRecorder(loop)
    socket = _AdversarialWebSocket()
    send_gate = asyncio.Event()
    socket.send_gate = send_gate
    client = CDPClient(socket, "ws://127.0.0.1/devtools/browser/test")
    client._schedule_best_effort_command("Target.closeTarget", {"targetId": "t1"})
    await _drain(2)
    assert len(client._background_tasks) == 1

    await client.close()
    assert client._background_tasks == set()
    send_gate.set()
    await _drain(4)
    recorder.assert_clean()
    recorder.restore()


@pytest.mark.asyncio
async def test_cdp_disconnect_during_detach_client_does_not_affect_sibling_session() -> None:
    loop = asyncio.get_running_loop()
    recorder = _LoopExceptionRecorder(loop)
    sock_a = _AdversarialWebSocket()
    sock_b = _AdversarialWebSocket()
    client_a = CDPClient(sock_a, "ws://127.0.0.1/devtools/browser/test")
    client_b = CDPClient(sock_b, "ws://127.0.0.1/devtools/browser/test")
    client_a._session_id = "session-A"
    client_a._client_target_id = "target-A"
    client_a._client_close_browser_on_loss = False
    client_b._session_id = "session-B"
    client_b._client_target_id = "target-B"
    client_b._client_close_browser_on_loss = False
    try:
        detach_a = asyncio.create_task(client_a.detach_client())
        await _drain(2)
        await sock_a.incoming.put(CDPConnectionClosedError())
        await asyncio.wait_for(detach_a, timeout=1)
        assert client_a.closed

        assert not client_b.closed
        cmd_b = asyncio.create_task(
            client_b.send_command("Runtime.evaluate", {}, session_id="session-B")
        )
        await _drain(2)
        await sock_b.incoming.put(json.dumps({"id": 1, "result": {"ok": True}}))
        assert await asyncio.wait_for(cmd_b, timeout=1) == {"ok": True}
    finally:
        await client_a.close()
        await client_b.close()
        await _drain(4)
        recorder.assert_clean()
        recorder.restore()


@pytest.mark.asyncio
async def test_cdp_boolean_response_id_does_not_resolve_command_id_1() -> None:
    loop = asyncio.get_running_loop()
    recorder = _LoopExceptionRecorder(loop)
    socket = _AdversarialWebSocket()
    client = CDPClient(socket, "ws://127.0.0.1/devtools/browser/test")
    try:
        cmd = asyncio.create_task(client.send_command("Runtime.evaluate", {}))
        await _drain(3)
        assert 1 in client._pending

        await socket.incoming.put(json.dumps({"id": True, "result": {"spoofed": True}}))
        await socket.incoming.put(json.dumps({"id": False, "result": {}}))
        await _drain(4)
        assert not cmd.done()
        assert 1 in client._pending

        await socket.incoming.put(json.dumps({"id": 1, "result": {"real": True}}))
        assert await asyncio.wait_for(cmd, timeout=1) == {"real": True}
    finally:
        await client.close()
        await _drain(4)
        recorder.assert_clean()
        recorder.restore()


@pytest.mark.asyncio
async def test_cdp_cancelled_close_caller_still_completes_cleanup_and_blocks_later_close() -> None:
    loop = asyncio.get_running_loop()
    recorder = _LoopExceptionRecorder(loop)
    socket = _AdversarialWebSocket()
    send_gate = asyncio.Event()
    close_gate = asyncio.Event()
    socket.send_gate = send_gate
    socket.close_gate = close_gate
    client = CDPClient(socket, "ws://127.0.0.1/devtools/browser/test")
    client._schedule_best_effort_command("Target.closeTarget", {"targetId": "t1"})
    await _drain(2)
    assert len(client._background_tasks) == 1
    try:
        first_close = asyncio.create_task(client.close())
        await asyncio.wait_for(socket.close_started.wait(), timeout=1)
        assert not first_close.done()
        assert not socket.closed
        assert client._background_tasks == set()

        first_close.cancel()
        with pytest.raises(asyncio.CancelledError):
            await first_close
        assert not socket.closed

        second_close = asyncio.create_task(client.close())
        await _drain(4)
        assert not second_close.done()

        close_gate.set()
        await asyncio.wait_for(second_close, timeout=1)
        assert socket.closed
        assert socket.close_count == 1
        assert client._reader.done()
    finally:
        send_gate.set()
        close_gate.set()
        await client.close()
        await _drain(4)
        recorder.assert_clean()
        recorder.restore()
