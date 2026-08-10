from __future__ import annotations

import asyncio
import base64
import json
import re
import sys
from typing import Any

from .runtime import BrowserTools, RuntimeConfig, stringify_result

_PROTOCOL_VERSION = "2025-06-18"

_ACTION_SCHEMAS: list[dict[str, Any]] = [
    {
        "type": "object",
        "properties": {
            "op": {"const": "click"},
            "id": {"type": "string", "minLength": 1},
        },
        "required": ["op", "id"],
        "additionalProperties": False,
    },
    {
        "type": "object",
        "properties": {
            "op": {"const": "hover"},
            "id": {"type": "string", "minLength": 1},
        },
        "required": ["op", "id"],
        "additionalProperties": False,
    },
    {
        "type": "object",
        "properties": {
            "op": {"const": "fill"},
            "id": {"type": "string", "minLength": 1},
            "value": {"type": "string"},
        },
        "required": ["op", "id", "value"],
        "additionalProperties": False,
    },
    {
        "type": "object",
        "properties": {
            "op": {"const": "type"},
            "id": {"type": "string", "minLength": 1},
            "text": {"type": "string"},
            "delay": {"type": "number", "minimum": 0},
        },
        "required": ["op", "id", "text"],
        "additionalProperties": False,
    },
    {
        "type": "object",
        "properties": {
            "op": {"const": "press"},
            "id": {"type": "string", "minLength": 1},
            "key": {"type": "string", "minLength": 1},
        },
        "required": ["op", "id", "key"],
        "additionalProperties": False,
    },
    {
        "type": "object",
        "properties": {
            "op": {"const": "select"},
            "id": {"type": "string", "minLength": 1},
            "values": {
                "oneOf": [
                    {"type": "string"},
                    {"type": "array", "items": {"type": "string"}, "minItems": 1},
                ]
            },
        },
        "required": ["op", "id", "values"],
        "additionalProperties": False,
    },
]

TOOLS: list[dict[str, Any]] = [
    {
        "name": "run",
        "description": (
            "Execute either a JavaScript workflow against the Stagehand Playwright facade or a "
            "batch of actions using IDs from the latest snapshot. Provide exactly one of code or "
            'actions. Each action must use "op" (never "kind") and "id" (never "ref"). Copy the '
            "bracketed snapshot ID as a string. Examples: "
            '{"actions":[{"op":"click","id":"1-42"}]}, '
            '{"actions":[{"op":"fill","id":"2-14","value":"Miami"}]}, '
            '{"actions":[{"op":"select","id":"3-9","values":"Lowest price"}]}.'
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "code": {
                    "type": "string",
                    "minLength": 1,
                    "description": (
                        "JavaScript async-function body. page, context, browser, startUrl, and "
                        "task are already in scope."
                    ),
                },
                "actions": {
                    "type": "array",
                    "items": {"oneOf": _ACTION_SCHEMAS},
                    "minItems": 1,
                },
            },
            # Deliberate deviation from the reference contract: no top-level
            # `oneOf` (code XOR actions). AI-SDK-based MCP clients (Eve,
            # Vercel AI SDK) reject tool input schemas with a top-level oneOf,
            # failing every run call client-side. The exclusivity is stated in
            # the description and enforced at runtime (runtime.py raises
            # "run requires exactly one of code or actions"). Mirrors the same
            # change in the TS facade contract
            # (packages/integrations/core/src/facade/contract.ts).
            "additionalProperties": False,
        },
    },
    {
        "name": "snapshot",
        "description": (
            "Capture the active page accessibility tree and hydrate its displayed IDs for "
            "subsequent run actions. Every call replaces the active page ID map."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {"includeIframes": {"type": "boolean", "default": True}},
            "additionalProperties": False,
        },
    },
    {
        "name": "screenshot",
        "description": "Capture a screenshot of the active page.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "fullPage": {"type": "boolean"},
                "type": {"type": "string", "enum": ["png", "jpeg"]},
                "quality": {"type": "number", "minimum": 0, "maximum": 100},
            },
            "additionalProperties": False,
        },
    },
]


class StdioServer:
    def __init__(self, config: RuntimeConfig | None = None) -> None:
        self._config = config or RuntimeConfig.from_env()
        self._tools: BrowserTools | None = None
        self._start_lock = asyncio.Lock()

    async def close(self) -> None:
        if self._tools is not None:
            await self._tools.close()
            self._tools = None

    async def handle(self, request: dict[str, Any]) -> dict[str, Any] | None:
        request_id = request.get("id")
        if request_id is None:
            return None
        method = request.get("method")
        try:
            if method == "initialize":
                params = request.get("params")
                requested = params.get("protocolVersion") if isinstance(params, dict) else None
                return self._success(
                    request_id,
                    {
                        "protocolVersion": requested or _PROTOCOL_VERSION,
                        "capabilities": {"tools": {"listChanged": False}},
                        "serverInfo": {"name": "stagehand_browser", "version": "0.1.0"},
                    },
                )
            if method == "ping":
                return self._success(request_id, {})
            if method == "tools/list":
                return self._success(request_id, {"tools": TOOLS})
            if method == "tools/call":
                return self._success(request_id, await self._call_tool(request.get("params")))
            return self._rpc_error(request_id, -32601, f"Method not found: {method}")
        except Exception as error:
            return self._success(
                request_id,
                {
                    "isError": True,
                    "content": [{"type": "text", "text": _sanitize_error(str(error))}],
                },
            )

    async def _call_tool(self, params: object) -> dict[str, Any]:
        if not isinstance(params, dict):
            raise TypeError("tools/call params must be an object")
        name = params.get("name")
        arguments = params.get("arguments", {})
        if not isinstance(arguments, dict):
            raise TypeError("tool arguments must be an object")
        tools = await self._browser_tools()

        if name == "run":
            code = arguments.get("code")
            actions = arguments.get("actions")
            result = await tools.run(
                code=code if isinstance(code, str) else None,
                actions=actions if isinstance(actions, list) else None,
            )
            return {"content": [{"type": "text", "text": stringify_result(result)}]}
        if name == "snapshot":
            include_iframes = arguments.get("includeIframes", True)
            if not isinstance(include_iframes, bool):
                raise TypeError("includeIframes must be a boolean")
            tree = await tools.snapshot(include_iframes=include_iframes)
            return {"content": [{"type": "text", "text": tree}]}
        if name == "screenshot":
            full_page = arguments.get("fullPage")
            image_type = arguments.get("type", "png")
            quality = arguments.get("quality")
            if full_page is not None and not isinstance(full_page, bool):
                raise TypeError("fullPage must be a boolean")
            if image_type not in {"png", "jpeg"}:
                raise ValueError("screenshot type must be png or jpeg")
            if quality is not None and (
                isinstance(quality, bool) or not isinstance(quality, (int, float))
            ):
                raise TypeError("quality must be a number")
            image, mime_type = await tools.screenshot(
                full_page=full_page,
                type=image_type,
                quality=quality,
            )
            return {
                "content": [
                    {"type": "text", "text": "Screenshot captured."},
                    {
                        "type": "image",
                        "data": base64.b64encode(image).decode("ascii"),
                        "mimeType": mime_type,
                    },
                ]
            }
        raise ValueError(f"Unknown tool: {name}")

    async def _browser_tools(self) -> BrowserTools:
        if self._tools is None:
            async with self._start_lock:
                if self._tools is None:
                    self._tools = await BrowserTools.start(self._config)
        return self._tools

    @staticmethod
    def _success(request_id: object, result: object) -> dict[str, Any]:
        return {"jsonrpc": "2.0", "id": request_id, "result": result}

    @staticmethod
    def _rpc_error(request_id: object, code: int, message: str) -> dict[str, Any]:
        return {
            "jsonrpc": "2.0",
            "id": request_id,
            "error": {"code": code, "message": message},
        }


def _sanitize_error(message: str) -> str:
    message = re.sub(
        r"([?&](?:signingKey|apiKey|api_key|token|key)=)[^&\s\"']+",
        r"\1[redacted]",
        message,
        flags=re.IGNORECASE,
    )
    return re.sub(r"\b(sk-[A-Za-z0-9_-]{6})[A-Za-z0-9_-]+", r"\1[redacted]", message)


async def serve() -> None:
    server = StdioServer()
    try:
        while line := await asyncio.to_thread(sys.stdin.readline):
            try:
                parsed = json.loads(line)
                if not isinstance(parsed, dict):
                    raise TypeError("request must be a JSON object")
                response = await server.handle(parsed)
            except Exception as error:
                response = StdioServer._rpc_error(None, -32700, _sanitize_error(str(error)))
            if response is not None:
                sys.stdout.write(json.dumps(response, separators=(",", ":")) + "\n")
                sys.stdout.flush()
    finally:
        await server.close()


def main() -> None:
    asyncio.run(serve())
