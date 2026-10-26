from __future__ import annotations

import base64
import binascii
import json
from typing import cast

from pydantic import JsonValue

from ._generated.models import (
    NavigationResponseDescriptor,
    NavigationSecurityDetails,
    NavigationServerAddr,
    ResponseAllHeadersResult,
    ResponseBodyResult,
    ResponseFinishedResult,
    ResponseHeadersArrayResult,
    ResponseIdParams,
    ResponseSecurityDetailsResult,
    ResponseServerAddrResult,
)
from .rpc_client import RPCClient


class Response:
    def __init__(self, rpc_client: RPCClient, descriptor: NavigationResponseDescriptor) -> None:
        self._rpc_client = rpc_client
        self._descriptor = descriptor.model_copy(deep=True)

    @property
    def url(self) -> str:
        return self._descriptor.url

    @property
    def status(self) -> int:
        return self._descriptor.status

    @property
    def status_text(self) -> str:
        return self._descriptor.status_text

    @property
    def ok(self) -> bool:
        return 200 <= self.status <= 299

    @property
    def headers(self) -> dict[str, str]:
        return dict(self._descriptor.headers)

    async def all_headers(self) -> dict[str, str]:
        result = await self._rpc_client.send(
            "response.all_headers",
            self._params(),
            ResponseAllHeadersResult,
        )
        return dict(result.headers)

    async def header_value(self, name: str) -> str | None:
        values = await self.header_values(name)
        return ", ".join(values) if values else None

    async def header_values(self, name: str) -> list[str]:
        normalized_name = name.lower()
        return [
            header["value"]
            for header in await self.headers_array()
            if header["name"].lower() == normalized_name
        ]

    async def headers_array(self) -> list[dict[str, str]]:
        result = await self._rpc_client.send(
            "response.headers_array",
            self._params(),
            ResponseHeadersArrayResult,
        )
        return [{"name": header.name, "value": header.value} for header in result.headers]

    @property
    def from_service_worker(self) -> bool:
        return self._descriptor.from_service_worker

    async def security_details(self) -> NavigationSecurityDetails | None:
        result = await self._rpc_client.send(
            "response.security_details",
            self._params(),
            ResponseSecurityDetailsResult,
        )
        return result.value.model_copy(deep=True) if result.value is not None else None

    async def server_addr(self) -> NavigationServerAddr | None:
        result = await self._rpc_client.send(
            "response.server_addr",
            self._params(),
            ResponseServerAddrResult,
        )
        return result.value.model_copy(deep=True) if result.value is not None else None

    async def body(self) -> bytes:
        result = await self._rpc_client.send(
            "response.body",
            self._params(),
            ResponseBodyResult,
        )
        try:
            decoded = base64.b64decode(result.body, validate=True)
        except (binascii.Error, ValueError) as error:
            raise ValueError("response.body returned invalid base64") from error
        if base64.b64encode(decoded).decode("ascii") != result.body:
            raise ValueError("response.body returned invalid base64")
        return decoded

    async def text(self) -> str:
        return (await self.body()).decode("utf-8")

    async def json(self) -> JsonValue:
        return cast(JsonValue, json.loads(await self.text()))

    async def finished(self) -> Exception | None:
        result = await self._rpc_client.send(
            "response.finished",
            self._params(),
            ResponseFinishedResult,
        )
        return RuntimeError(result.error.message) if result.error is not None else None

    def _params(self) -> ResponseIdParams:
        return ResponseIdParams(response_id=self._descriptor.response_id)
