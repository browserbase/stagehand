from __future__ import annotations

import asyncio
import json
import os
import re
import signal
import sys
import time
from collections.abc import Callable, Mapping
from contextlib import AsyncExitStack
from dataclasses import dataclass
from typing import Any

from deepagents import create_deep_agent
from deepagents._models import get_model_identifier, get_model_provider
from deepagents.profiles import (
    GeneralPurposeSubagentProfile,
    HarnessProfile,
    register_harness_profile,
)
from langchain_core.language_models import BaseChatModel
from langchain_core.messages import AIMessage, ToolMessage
from langchain_mcp_adapters.client import MultiServerMCPClient
from langchain_mcp_adapters.tools import load_mcp_tools
from langgraph.errors import GraphRecursionError

Event = dict[str, Any]
Emitter = Callable[[Event], None]


@dataclass(frozen=True)
class McpServerConfig:
    command: str
    args: list[str]
    env: dict[str, str] | None = None
    cwd: str | None = None


@dataclass(frozen=True)
class RunnerConfig:
    prompt: str
    system_prompt: str | None
    model: str
    mcp_servers: dict[str, McpServerConfig]
    recursion_limit: int
    max_tool_steps: int


def _require_string(value: object, name: str, *, nullable: bool = False) -> str | None:
    if nullable and value is None:
        return None
    if not isinstance(value, str):
        raise ValueError(f"{name} must be a string{' or null' if nullable else ''}")
    return value


def _require_positive_int(value: object, name: str) -> int:
    if not isinstance(value, int) or isinstance(value, bool) or value <= 0:
        raise ValueError(f"{name} must be a positive integer")
    return value


def parse_config(raw: dict[str, Any]) -> RunnerConfig:
    if not isinstance(raw, dict):
        raise ValueError("configuration must be a JSON object")
    if "system_prompt" not in raw:
        raise ValueError("system_prompt is required")
    servers_raw = raw.get("mcp_servers")
    if not isinstance(servers_raw, dict):
        raise ValueError("mcp_servers must be an object")
    servers: dict[str, McpServerConfig] = {}
    for name, server_raw in servers_raw.items():
        if not isinstance(name, str) or not name:
            raise ValueError("mcp_servers keys must be non-empty strings")
        if not isinstance(server_raw, dict):
            raise ValueError(f'mcp server "{name}" must be an object')
        command = server_raw.get("command")
        args = server_raw.get("args")
        env = server_raw.get("env")
        cwd = server_raw.get("cwd")
        if not isinstance(command, str) or not command:
            raise ValueError(f'mcp server "{name}" command must be a non-empty string')
        if not isinstance(args, list) or not all(isinstance(arg, str) for arg in args):
            raise ValueError(f'mcp server "{name}" args must be an array of strings')
        if env is not None and (
            not isinstance(env, dict)
            or not all(
                isinstance(key, str) and isinstance(value, str) for key, value in env.items()
            )
        ):
            raise ValueError(f'mcp server "{name}" env must be a string map')
        if cwd is not None and not isinstance(cwd, str):
            raise ValueError(f'mcp server "{name}" cwd must be a string')
        servers[name] = McpServerConfig(
            command,
            list(args),
            dict(env) if env is not None else None,
            cwd,
        )
    return RunnerConfig(
        prompt=str(_require_string(raw.get("prompt"), "prompt")),
        system_prompt=_require_string(raw.get("system_prompt"), "system_prompt", nullable=True),
        model=str(_require_string(raw.get("model"), "model")),
        mcp_servers=servers,
        recursion_limit=_require_positive_int(raw.get("recursion_limit"), "recursion_limit"),
        max_tool_steps=_require_positive_int(raw.get("max_tool_steps"), "max_tool_steps"),
    )


def flatten_text(content: object) -> str:
    if isinstance(content, str):
        return content
    if not isinstance(content, list):
        return "" if content is None else str(content)
    parts: list[str] = []
    for block in content:
        if isinstance(block, str):
            parts.append(block)
        elif (
            isinstance(block, dict)
            and block.get("type") == "text"
            and isinstance(block.get("text"), str)
        ):
            parts.append(block["text"])
        elif isinstance(block, dict) and _image_from_block(block) is not None:
            continue
        else:
            try:
                parts.append(json.dumps(block, separators=(",", ":"), default=str))
            except (TypeError, ValueError):
                parts.append(str(block))
    return "\n".join(parts)


def _image_from_block(block: Mapping[str, object]) -> dict[str, str] | None:
    data = block.get("base64", block.get("data"))
    mime_type = block.get("mime_type", block.get("mimeType"))
    if block.get("type") == "image" and isinstance(data, str) and isinstance(mime_type, str):
        return {"data": data, "mime_type": mime_type}
    return None


def extract_images(content: object) -> list[dict[str, str]]:
    if not isinstance(content, list):
        return []
    images: list[dict[str, str]] = []
    for block in content:
        if isinstance(block, dict) and (image := _image_from_block(block)):
            images.append(image)
    return images


def _json_safe(value: object) -> object:
    try:
        json.dumps(value)
        return value
    except (TypeError, ValueError):
        return str(value)


def message_events(message: object, tool_servers: Mapping[str, str]) -> list[Event]:
    if isinstance(message, AIMessage):
        calls = [
            {
                "id": str(call.get("id", "")),
                "name": str(call.get("name", "")),
                "args": call.get("args") if isinstance(call.get("args"), dict) else {},
            }
            for call in message.tool_calls
        ]
        events: list[Event] = [
            {
                "type": "assistant",
                "text": flatten_text(message.content),
                "tool_calls": calls,
                "usage": _json_safe(message.usage_metadata) if message.usage_metadata else None,
            }
        ]
        events.extend(
            {
                "type": "tool_call",
                "id": call["id"],
                "name": call["name"],
                "server": tool_servers.get(str(call["name"])),
                "args": call["args"],
            }
            for call in calls
        )
        return events
    if isinstance(message, ToolMessage):
        artifact = message.artifact
        if isinstance(artifact, dict):
            structured = artifact.get("structured_content")
        else:
            structured = getattr(artifact, "structured_content", None)
        name = message.name or ""
        return [
            {
                "type": "tool_result",
                "id": message.tool_call_id,
                "name": name,
                "server": tool_servers.get(name),
                "ok": message.status == "success",
                "text": flatten_text(message.content),
                "images": extract_images(message.content),
                "structured": _json_safe(structured) if structured is not None else None,
            }
        ]
    return []


def aggregate_usage(usages: list[Mapping[str, object] | None]) -> dict[str, int]:
    totals = {
        "input_tokens": 0,
        "output_tokens": 0,
        "cache_read_input_tokens": 0,
        "reasoning_output_tokens": 0,
        "total_tokens": 0,
    }
    for usage in usages:
        if not usage:
            continue
        totals["input_tokens"] += _integer(usage.get("input_tokens"))
        totals["output_tokens"] += _integer(usage.get("output_tokens"))
        totals["total_tokens"] += _integer(usage.get("total_tokens"))
        input_details = usage.get("input_token_details")
        output_details = usage.get("output_token_details")
        if isinstance(input_details, Mapping):
            totals["cache_read_input_tokens"] += _integer(input_details.get("cache_read"))
        if isinstance(output_details, Mapping):
            totals["reasoning_output_tokens"] += _integer(output_details.get("reasoning"))
    return totals


def _integer(value: object) -> int:
    return value if isinstance(value, int) and not isinstance(value, bool) else 0


def sanitize_error(message: str) -> str:
    for name, value in os.environ.items():
        if (
            len(value) >= 6
            and re.search(
                r"(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|AUTH)",
                name,
                flags=re.IGNORECASE,
            )
        ):
            message = message.replace(value, "[redacted]")
    message = re.sub(
        r"\b((?:https?|wss?)://)[^/@\s:]+:[^/@\s]+@",
        r"\1[redacted]@",
        message,
        flags=re.IGNORECASE,
    )
    message = re.sub(
        (
            r"([?&](?:signingKey|apiKey|api_key|access_token|auth|authorization|"
            r"client_secret|credential|password|secret|token|key)=)[^&\s\"']+"
        ),
        r"\1[redacted]",
        message,
        flags=re.IGNORECASE,
    )
    message = re.sub(
        r"\b(sk-[A-Za-z0-9_-]{6})[A-Za-z0-9_-]+", r"\1[redacted]", message
    )
    message = re.sub(
        r"\b(bb_(?:live|test)_[A-Za-z0-9]{4})[A-Za-z0-9_-]+",
        r"\1[redacted]",
        message,
    )
    message = re.sub(r"\bAIza[0-9A-Za-z_-]{30,}", "AIza[redacted]", message)
    message = re.sub(
        (
            r"\b((?:(?:gh[pousr]|github_pat)_[A-Za-z0-9]{4}|"
            r"(?:xox[baprs]|sk-ant)-[A-Za-z0-9]{4}))[A-Za-z0-9_-]+"
        ),
        r"\1[redacted]",
        message,
        flags=re.IGNORECASE,
    )
    return re.sub(
        r"\b(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}",
        r"\1[redacted]",
        message,
        flags=re.IGNORECASE,
    )


def _sanitize_strings(value: object) -> object:
    if isinstance(value, str):
        return sanitize_error(value)
    if isinstance(value, list):
        return [_sanitize_strings(item) for item in value]
    if isinstance(value, dict):
        return {key: _sanitize_strings(item) for key, item in value.items()}
    return value


def _sanitize_event(event: Event) -> Event:
    return {key: _sanitize_strings(value) for key, value in event.items()}


def print_line(event: Event) -> None:
    sys.stdout.write(json.dumps(event, separators=(",", ":"), default=str) + "\n")
    sys.stdout.flush()


_EXCLUDED_AGENT_TOOLS = frozenset(
    {
        "delete",
        "edit_file",
        "execute",
        "glob",
        "grep",
        "ls",
        "read_file",
        "write_file",
        "write_todos",
    }
)
_REGISTERED_PROFILE_KEYS: set[str] = set()


def _register_eval_harness_profile(model: str | BaseChatModel) -> None:
    if isinstance(model, str):
        profile_key = model
    else:
        identifier = get_model_identifier(model)
        provider = get_model_provider(model)
        if provider is None or identifier is None or ":" in identifier:
            raise ValueError(
                "pre-built test model must expose a provider and unqualified identifier"
            )
        profile_key = f"{provider}:{identifier}"
    if profile_key in _REGISTERED_PROFILE_KEYS:
        return
    register_harness_profile(
        profile_key,
        HarnessProfile(
            excluded_tools=_EXCLUDED_AGENT_TOOLS,
            excluded_middleware=frozenset({"SummarizationMiddleware"}),
            general_purpose_subagent=GeneralPurposeSubagentProfile(enabled=False),
        ),
    )
    _REGISTERED_PROFILE_KEYS.add(profile_key)


def _default_build_agent(
    config: RunnerConfig,
    tools: list[object],
    *,
    model: BaseChatModel | None = None,
) -> object:
    resolved_model: str | BaseChatModel = model or config.model
    _register_eval_harness_profile(resolved_model)
    return create_deep_agent(
        model=resolved_model,
        tools=tools,
        system_prompt=config.system_prompt,
    )


async def run(
    config: RunnerConfig,
    *,
    build_agent: Callable[[RunnerConfig, list[object]], object] | None = None,
    emit: Emitter = print_line,
) -> int:
    last_text = ""
    usages: list[Mapping[str, object] | None] = []
    tool_result_count = 0
    emitted_message_ids: set[tuple[str, str]] = set()
    had_failure = False

    def emit_event(event: Event) -> None:
        nonlocal had_failure
        is_error = event.get("type") == "error"
        is_failed_tool = event.get("type") == "tool_result" and event.get("ok") is False
        if is_error or is_failed_tool:
            had_failure = True
        if is_error or is_failed_tool or (event.get("type") == "final" and had_failure):
            event = _sanitize_event(event)
        emit({**event, "ts": time.time()})

    stack = AsyncExitStack()
    try:
        tools: list[object] = []
        tool_servers: dict[str, str] = {}
        if config.mcp_servers:
            connections = {
                name: {
                    "transport": "stdio",
                    "command": server.command,
                    "args": server.args,
                    **({"env": server.env} if server.env is not None else {}),
                    **({"cwd": server.cwd} if server.cwd is not None else {}),
                }
                for name, server in config.mcp_servers.items()
            }
            client = MultiServerMCPClient(connections)  # type: ignore[arg-type]
            for name in config.mcp_servers:
                session = await stack.enter_async_context(client.session(name))
                server_tools = await load_mcp_tools(session, server_name=name)
                tools.extend(server_tools)
                tool_servers.update({tool.name: name for tool in server_tools})

        agent = (build_agent or _default_build_agent)(config, tools)
        stream = agent.astream(  # type: ignore[attr-defined]
            {"messages": [{"role": "user", "content": config.prompt}]},
            config={"recursion_limit": config.recursion_limit},
            stream_mode="updates",
        )
        async for chunk in stream:
            if not isinstance(chunk, dict):
                continue
            budget_reached = False
            for update in chunk.values():
                if not isinstance(update, dict) or not isinstance(update.get("messages"), list):
                    continue
                for message in update["messages"]:
                    message_key: tuple[str, str] | None = None
                    if isinstance(message, AIMessage) and message.id:
                        message_key = ("assistant", message.id)
                    elif isinstance(message, ToolMessage):
                        identifier = message.id or message.tool_call_id
                        if identifier:
                            message_key = ("tool", identifier)
                    if message_key is not None:
                        if message_key in emitted_message_ids:
                            continue
                        emitted_message_ids.add(message_key)
                    if isinstance(message, AIMessage):
                        last_text = flatten_text(message.content)
                        usages.append(message.usage_metadata)
                    for event in message_events(message, tool_servers):
                        emit_event(event)
                        if event["type"] == "tool_result":
                            tool_result_count += 1
                            if tool_result_count >= config.max_tool_steps:
                                budget_reached = True
            if budget_reached:
                emit_event(
                    {
                        "type": "error",
                        "kind": "tool_step_budget",
                        "message": (
                            "tool step budget exhausted "
                            f"({config.max_tool_steps} steps)"
                        ),
                    }
                )
                await stream.aclose()
                break
    except GraphRecursionError as error:
        emit_event(
            {
                "type": "error",
                "kind": "recursion_limit",
                "message": sanitize_error(str(error)),
            }
        )
    except (KeyboardInterrupt, asyncio.CancelledError):
        emit_event({"type": "error", "kind": "exception", "message": "terminated"})
        emit_event({"type": "final", "text": last_text})
        emit_event({"type": "usage", **aggregate_usage(usages)})
        return 1
    except Exception as error:  # noqa: BLE001
        emit_event({"type": "error", "kind": "exception", "message": sanitize_error(str(error))})
        emit_event({"type": "final", "text": last_text})
        emit_event({"type": "usage", **aggregate_usage(usages)})
        return 1
    finally:
        # Best-effort teardown: a flaky MCP session close after the stream
        # finished must not convert a completed run into an exit-1 failure
        # (the Node side maps any nonzero exit to sdk_error) or emit an
        # error event that overwrites the real stop classification.
        try:
            await stack.aclose()
        except Exception:  # noqa: BLE001
            pass

    emit_event({"type": "final", "text": last_text})
    emit_event({"type": "usage", **aggregate_usage(usages)})
    return 0


def _terminated(_signum: int, _frame: object) -> None:
    raise KeyboardInterrupt


def main() -> int:
    signal.signal(signal.SIGTERM, _terminated)
    try:
        raw = json.loads(sys.stdin.read())
        config = parse_config(raw)
    except (json.JSONDecodeError, ValueError, TypeError) as error:
        print_line(
            {
                "type": "error",
                "kind": "config",
                "message": sanitize_error(str(error)),
                "ts": time.time(),
            }
        )
        return 2
    try:
        return asyncio.run(run(config))
    except KeyboardInterrupt:
        print_line(
            {"type": "error", "kind": "exception", "message": "terminated", "ts": time.time()}
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
