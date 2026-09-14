from __future__ import annotations

from collections.abc import Mapping
from typing import Literal, cast

from pydantic import BaseModel, ConfigDict, JsonValue

from ._generated.models import (
    PageVoidResult,
    PageWebMCPCancelInvocationParams,
    PageWebMCPInvocationResultParams,
    PageWebMCPInvokeToolParams,
    WebMCPAnnotation,
    WebMCPInvocationDescriptor,
    WebMCPResultOptions,
    WebMCPToolDescriptor,
)
from ._generated.models import (
    WebMCPToolResponse as WireWebMCPToolResponse,
)
from .rpc_client import RPCClient

WebMCPInvocationStatus = Literal["Completed", "Canceled", "Error"]


class WebMCPToolResponse(BaseModel):
    model_config = ConfigDict(frozen=True)

    invocation_id: str
    status: WebMCPInvocationStatus
    output: JsonValue | None = None
    error_text: str | None = None
    exception: dict[str, JsonValue] | None = None


class WebMCPTool:
    def __init__(
        self,
        rpc_client: RPCClient,
        page_id: str,
        descriptor: WebMCPToolDescriptor,
    ) -> None:
        data = descriptor.model_dump(mode="json", exclude_unset=True)
        self._rpc_client = rpc_client
        self._page_id = page_id
        self._name = descriptor.name
        self._description = descriptor.description
        self._input_schema = cast(dict[str, JsonValue] | None, data.get("input_schema"))
        self._annotations = descriptor.annotations
        self._frame_id = descriptor.frame_id
        self._backend_node_id = descriptor.backend_node_id

    @property
    def name(self) -> str:
        return self._name

    @property
    def description(self) -> str:
        return self._description

    @property
    def input_schema(self) -> dict[str, JsonValue] | None:
        return self._input_schema

    @property
    def annotations(self) -> WebMCPAnnotation | None:
        return self._annotations

    @property
    def frame_id(self) -> str:
        return self._frame_id

    @property
    def backend_node_id(self) -> int | None:
        return self._backend_node_id

    async def invoke(
        self,
        *,
        input: Mapping[str, JsonValue] | None = None,
    ) -> WebMCPInvocation:
        descriptor = await self._rpc_client.send(
            "page.webmcp_invoke_tool",
            PageWebMCPInvokeToolParams.model_validate({
                "page_id": self._page_id,
                "frame_id": self.frame_id,
                "tool_name": self.name,
                "input": {} if input is None else dict(input),
            }),
            WebMCPInvocationDescriptor,
        )
        return WebMCPInvocation(self._rpc_client, self._page_id, descriptor)


class WebMCPInvocation:
    def __init__(
        self,
        rpc_client: RPCClient,
        page_id: str,
        descriptor: WebMCPInvocationDescriptor,
    ) -> None:
        data = descriptor.model_dump(mode="json")
        self._rpc_client = rpc_client
        self._page_id = page_id
        self._invocation_id = descriptor.invocation_id
        self._tool_name = descriptor.tool_name
        self._frame_id = descriptor.frame_id
        self._input = cast(dict[str, JsonValue], data["input"])
        self._terminal_result: WebMCPToolResponse | None = None

    @property
    def invocation_id(self) -> str:
        return self._invocation_id

    @property
    def tool_name(self) -> str:
        return self._tool_name

    @property
    def frame_id(self) -> str:
        return self._frame_id

    @property
    def input(self) -> dict[str, JsonValue]:
        return self._input

    async def result(self, *, timeout: float | None = None) -> WebMCPToolResponse:
        if self._terminal_result is not None:
            return self._terminal_result

        params = PageWebMCPInvocationResultParams(
            page_id=self._page_id,
            invocation_id=self.invocation_id,
        )
        if timeout is not None:
            params.options = WebMCPResultOptions(timeout=timeout)
        response = await self._rpc_client.send(
            "page.webmcp_invocation_result",
            params,
            WireWebMCPToolResponse,
        )
        self._terminal_result = WebMCPToolResponse.model_validate(
            response.model_dump(mode="json", exclude_unset=True)
        )
        return self._terminal_result

    async def cancel(self) -> None:
        await self._rpc_client.send(
            "page.webmcp_cancel_invocation",
            PageWebMCPCancelInvocationParams(
                page_id=self._page_id,
                invocation_id=self.invocation_id,
            ),
            PageVoidResult,
        )
