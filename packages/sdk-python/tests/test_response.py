from __future__ import annotations

from typing import cast

import pytest

from stagehand import Response
from stagehand._generated.models import NavigationResponseDescriptor, ResponseIdParams
from stagehand.rpc_client import RPCClient

from ._support import RecordingRPCClient


def descriptor() -> NavigationResponseDescriptor:
    return NavigationResponseDescriptor(
        response_id="response-1",
        url="https://example.test/final",
        status=201,
        status_text="Created",
        headers={"content-type": "application/json"},
        from_service_worker=True,
    )


def test_response_exposes_immediate_metadata_with_defensive_header_copies() -> None:
    recording = RecordingRPCClient()
    response = Response(cast(RPCClient, recording), descriptor())

    assert response.url == "https://example.test/final"
    assert response.status == 201
    assert response.status_text == "Created"
    assert response.ok is True
    assert response.from_service_worker is True

    headers = response.headers
    headers["content-type"] = "mutated"
    assert response.headers == {"content-type": "application/json"}
    assert recording.calls == []


@pytest.mark.asyncio
async def test_response_retrieves_headers_and_connection_metadata_lazily() -> None:
    recording = RecordingRPCClient({
        "response.all_headers": {
            "headers": {
                "Content-Type": "application/json",
                "Set-Cookie": "first=1\nsecond=2",
            }
        },
        "response.headers_array": {
            "headers": [
                {"name": "Set-Cookie", "value": "first=1"},
                {"name": "set-cookie", "value": "second=2"},
            ]
        },
        "response.security_details": {
            "value": {
                "issuer": "Example CA",
                "protocol": "TLS 1.3",
                "subject_name": "example.test",
                "valid_from": 1.0,
                "valid_to": 2.0,
            }
        },
        "response.server_addr": {"value": {"ip_address": "203.0.113.10", "port": 443}},
    })
    response = Response(cast(RPCClient, recording), descriptor())

    assert await response.all_headers() == {
        "Content-Type": "application/json",
        "Set-Cookie": "first=1\nsecond=2",
    }
    headers = await response.headers_array()
    headers[0]["value"] = "mutated"
    assert await response.header_value("SET-cookie") == "first=1, second=2"
    assert await response.header_values("set-COOKIE") == ["first=1", "second=2"]

    security_details = await response.security_details()
    assert security_details is not None
    assert security_details.subject_name == "example.test"
    server_addr = await response.server_addr()
    assert server_addr is not None
    assert server_addr.ip_address == "203.0.113.10"
    assert server_addr.port == 443

    assert [method for method, _, _ in recording.calls] == [
        "response.all_headers",
        "response.headers_array",
        "response.headers_array",
        "response.headers_array",
        "response.security_details",
        "response.server_addr",
    ]
    assert all(
        params == ResponseIdParams(response_id="response-1") for _, params, _ in recording.calls
    )


@pytest.mark.asyncio
async def test_response_decodes_body_text_and_json_through_independent_rpc_calls() -> None:
    recording = RecordingRPCClient({
        "response.body": {
            "body": "eyJvayI6dHJ1ZX0=",
            "base64_encoded": True,
        }
    })
    response = Response(cast(RPCClient, recording), descriptor())

    assert await response.body() == b'{"ok":true}'
    assert await response.text() == '{"ok":true}'
    assert await response.json() == {"ok": True}
    assert [method for method, _, _ in recording.calls] == [
        "response.body",
        "response.body",
        "response.body",
    ]


@pytest.mark.asyncio
async def test_response_surfaces_finished_failures_transport_errors_and_malformed_bodies() -> None:
    recording = RecordingRPCClient({
        "response.finished": {"error": {"message": "net::ERR_FAILED"}},
        "response.body": {"body": "%%%", "base64_encoded": True},
        "response.all_headers": RuntimeError("handle unavailable"),
    })
    response = Response(cast(RPCClient, recording), descriptor())

    finished_error = await response.finished()
    assert isinstance(finished_error, RuntimeError)
    assert str(finished_error) == "net::ERR_FAILED"
    with pytest.raises(ValueError, match="response.body returned invalid base64"):
        await response.body()
    with pytest.raises(RuntimeError, match="handle unavailable"):
        await response.all_headers()


@pytest.mark.asyncio
async def test_response_finished_returns_none_after_success() -> None:
    recording = RecordingRPCClient({"response.finished": {"error": None}})
    response = Response(cast(RPCClient, recording), descriptor())

    assert await response.finished() is None
