import asyncio
import json
import math
import os
import re
import signal
import sys
import time
from collections.abc import AsyncIterable, Awaitable, Callable, Mapping
from contextlib import AsyncExitStack
from dataclasses import dataclass
from typing import Any

from pydantic import BaseModel, Field
from pydantic_ai import (
    Agent,
    AgentStreamEvent,
    FunctionToolCallEvent,
    FunctionToolResultEvent,
    PartEndEvent,
    RunContext,
)
from pydantic_ai.exceptions import RunCancelled, UsageLimitExceeded
from pydantic_ai.mcp import MCPToolset, StdioTransport
from pydantic_ai.messages import TextPart, ThinkingPart
from pydantic_ai.models.openai import OpenAIResponsesModel, OpenAIResponsesModelSettings
from pydantic_ai.usage import UsageLimits

Event = dict[str, Any]
Emitter = Callable[[Event], None]


class EvalResult(BaseModel):
    success: bool = Field(description="Whether the benchmark task succeeded")
    summary: str = Field(description="Short description of what happened")
    finalAnswer: str = Field(description="The answer or outcome for the verifier")


def _env_float(name: str, default: float) -> float:
    """Read a non-negative float from the environment; 0 disables the guard."""
    raw = os.environ.get(name)
    if raw is None or raw.strip() == "":
        return default
    try:
        value = float(raw)
    except ValueError:
        return default
    return value if math.isfinite(value) and value >= 0 else default


INACTIVITY_TIMEOUT_S = _env_float("PYDANTIC_AI_INACTIVITY_TIMEOUT_S", 240.0)
WALL_TIMEOUT_S = _env_float("PYDANTIC_AI_WALL_TIMEOUT_S", 2400.0)
MCP_SETUP_TIMEOUT_S = _env_float("PYDANTIC_AI_MCP_SETUP_TIMEOUT_S", 120.0)
CLEANUP_TIMEOUT_S = 5.0


class _WatchdogExpired(TimeoutError):
    """Only a deadline owned by this runner expired, not an inner operation."""


async def _with_optional_timeout(coro: Awaitable[object], timeout: float) -> object:
    deadline = asyncio.timeout(timeout if timeout > 0 else None)
    try:
        async with deadline:
            return await coro
    except TimeoutError as error:
        if deadline.expired():
            raise _WatchdogExpired from error
        raise


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
    reasoning_summary: str | None = None


_REASONING_SUMMARY_MODES = frozenset({"auto", "concise", "detailed"})


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
    reasoning_summary = _require_string(
        raw.get("reasoning_summary"), "reasoning_summary", nullable=True
    )
    if reasoning_summary is not None and reasoning_summary not in _REASONING_SUMMARY_MODES:
        raise ValueError("reasoning_summary must be one of auto, concise, detailed or null")
    return RunnerConfig(
        prompt=str(_require_string(raw.get("prompt"), "prompt")),
        system_prompt=_require_string(raw.get("system_prompt"), "system_prompt", nullable=True),
        model=str(_require_string(raw.get("model"), "model")),
        mcp_servers=servers,
        recursion_limit=_require_positive_int(raw.get("recursion_limit"), "recursion_limit"),
        max_tool_steps=_require_positive_int(raw.get("max_tool_steps"), "max_tool_steps"),
        reasoning_summary=reasoning_summary,
    )


def flatten_text(content: object) -> str:
    """The model's visible text; thinking blocks are reported separately."""
    if isinstance(content, str):
        return content
    if content is None:
        return ""
    if not isinstance(content, list):
        return str(content)
    parts: list[str] = []
    for block in content:
        if isinstance(block, str):
            parts.append(block)
            continue
        if isinstance(block, dict) and _image_from_block(block) is not None:
            continue
        text = getattr(block, "content", None)
        if (
            isinstance(block, dict)
            and block.get("type") == "text"
            and isinstance(block.get("text"), str)
        ):
            parts.append(block["text"])
        elif isinstance(text, str):
            parts.append(text)
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
    images: list[dict[str, str]] = []
    if isinstance(content, list):
        for block in content:
            if isinstance(block, dict) and (image := _image_from_block(block)):
                images.append(image)
                continue
            media_type = getattr(block, "media_type", None)
            data = getattr(block, "data", None)
            if isinstance(media_type, str) and isinstance(data, (bytes, bytearray)):
                import base64

                images.append(
                    {
                        "data": base64.b64encode(bytes(data)).decode("ascii"),
                        "mime_type": media_type,
                    }
                )
    return images


def _json_safe(value: object) -> object:
    try:
        json.dumps(value)
        return value
    except (TypeError, ValueError):
        return str(value)


def _integer(value: object) -> int:
    return value if isinstance(value, int) and not isinstance(value, bool) else 0


def aggregate_usage(usage: object | None) -> dict[str, int | bool]:
    totals = {
        "input_tokens": 0,
        "output_tokens": 0,
        "cache_read_input_tokens": 0,
        "reasoning_output_tokens": 0,
        "total_tokens": 0,
        "reported": False,
    }
    if usage is None:
        return totals
    input_tokens = _integer(getattr(usage, "input_tokens", None))
    output_tokens = _integer(getattr(usage, "output_tokens", None))
    cache_read = _integer(getattr(usage, "cache_read_tokens", None))
    details = getattr(usage, "details", None)
    reasoning = 0
    if isinstance(details, Mapping):
        cache_read += _integer(details.get("cache_read_tokens") or details.get("cache_read"))
        reasoning += _integer(
            details.get("reasoning_tokens") or details.get("reasoning_output_tokens")
        )
    reported = any(
        getattr(usage, name, None) is not None for name in ("input_tokens", "output_tokens")
    )
    return {
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "cache_read_input_tokens": cache_read,
        "reasoning_output_tokens": reasoning,
        "total_tokens": input_tokens + output_tokens,
        "reported": reported,
    }


def sanitize_error(message: str) -> str:
    for name, value in os.environ.items():
        if len(value) >= 6 and re.search(
            r"(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|AUTH)",
            name,
            flags=re.IGNORECASE,
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
    message = re.sub(r"\b(sk-[A-Za-z0-9_-]{6})[A-Za-z0-9_-]+", r"\1[redacted]", message)
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


def thinking_text(part: object) -> str:
    """Visible reasoning for a ThinkingPart; raw provider content stays hidden."""
    content = getattr(part, "content", None)
    if isinstance(content, str) and content:
        return content
    details = getattr(part, "provider_details", None)
    if isinstance(details, Mapping):
        raw = details.get("raw_content")
        if isinstance(raw, str):
            return raw
    return ""


def build_eval_model(config: RunnerConfig) -> str | OpenAIResponsesModel:
    """The agent model; OpenAI models are asked for reasoning summaries.

    The Responses API only returns reasoning text when `openai_reasoning_summary`
    is requested. String model IDs otherwise keep Pydantic AI's default routing.
    """
    if config.reasoning_summary is None or not config.model.startswith("openai:"):
        return config.model
    return OpenAIResponsesModel(config.model.split(":", 1)[1])


def build_eval_model_settings(config: RunnerConfig) -> OpenAIResponsesModelSettings | None:
    if config.reasoning_summary is None or not config.model.startswith("openai:"):
        return None
    return OpenAIResponsesModelSettings(openai_reasoning_summary=config.reasoning_summary)


def _default_build_agent(
    config: RunnerConfig,
    toolsets: list[object],
    *,
    model: object | None = None,
) -> Agent[None, EvalResult]:
    return Agent(
        model or build_eval_model(config),
        name="stagehand_pydantic_ai_eval_agent",
        instructions=config.system_prompt or "",
        output_type=EvalResult,
        toolsets=toolsets,  # type: ignore[arg-type]
        model_settings=build_eval_model_settings(config),
    )


def _tool_args(part: object) -> dict[str, Any]:
    args = getattr(part, "args", None)
    if isinstance(args, dict):
        return args
    if isinstance(args, str):
        try:
            parsed = json.loads(args)
        except (TypeError, ValueError, json.JSONDecodeError):
            return {"raw": args}
        return parsed if isinstance(parsed, dict) else {"raw": parsed}
    return {}


async def run(
    config: RunnerConfig,
    *,
    build_agent: Callable[..., Agent[None, EvalResult]] | None = None,
    emit: Emitter = print_line,
) -> int:
    last_text = ""
    tool_result_count = 0
    had_failure = False
    usage_obj: object | None = None
    tool_servers: dict[str, str] = {}

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
        toolsets: list[object] = []
        if config.mcp_servers:
            for name, server in config.mcp_servers.items():
                transport = StdioTransport(
                    command=server.command,
                    args=server.args,
                    env=server.env,
                    cwd=server.cwd,
                )
                toolset = MCPToolset(transport, id=name, tool_error_behavior="failed")
                try:
                    await _with_optional_timeout(
                        stack.enter_async_context(toolset),
                        MCP_SETUP_TIMEOUT_S,
                    )
                except _WatchdogExpired:
                    emit_event(
                        {
                            "type": "error",
                            "kind": "mcp_setup_timeout",
                            "message": (
                                f"MCP server '{name}' did not become ready within "
                                f"{MCP_SETUP_TIMEOUT_S:g}s"
                            ),
                        }
                    )
                    emit_event({"type": "final", "text": last_text})
                    emit_event({"type": "usage", **aggregate_usage(None)})
                    return 1
                toolsets.append(toolset)
                listed = await toolset.list_tools()
                for tool in listed:
                    tool_name = getattr(tool, "name", None)
                    if isinstance(tool_name, str):
                        tool_servers[tool_name] = name

        agent = (build_agent or _default_build_agent)(config, toolsets)

        stop_kind: str | None = None

        async def event_stream_handler(
            ctx: RunContext[None],
            event_stream: AsyncIterable[AgentStreamEvent],
        ) -> None:
            nonlocal last_text, tool_result_count, stop_kind
            iterator = event_stream.__aiter__()
            while True:
                try:
                    event = await _with_optional_timeout(
                        iterator.__anext__(),
                        INACTIVITY_TIMEOUT_S,
                    )
                except StopAsyncIteration:
                    break
                except _WatchdogExpired:
                    stop_kind = "inactivity_timeout"
                    ctx.cancel()
                    return
                mapped = _map_event(event, tool_servers)
                for item in mapped:
                    if item["type"] == "assistant" and isinstance(item.get("text"), str):
                        last_text = item["text"]
                    emit_event(item)
                    if item["type"] == "tool_result":
                        tool_result_count += 1
                        if tool_result_count >= config.max_tool_steps:
                            stop_kind = "tool_step_budget"
                            ctx.cancel()
                            return

        # A stalled `agent.run` that never enters the handler is bounded by the
        # wall clock, or by inactivity when the wall clock is disabled.
        outer_timeout = WALL_TIMEOUT_S if WALL_TIMEOUT_S > 0 else INACTIVITY_TIMEOUT_S
        outer_kind = (
            "wall_timeout"
            if WALL_TIMEOUT_S > 0
            else ("inactivity_timeout" if INACTIVITY_TIMEOUT_S > 0 else None)
        )

        try:
            result = await _with_optional_timeout(
                agent.run(
                    config.prompt,
                    event_stream_handler=event_stream_handler,
                    usage_limits=UsageLimits(
                        request_limit=max(config.recursion_limit, 1),
                        tool_calls_limit=config.max_tool_steps,
                    ),
                ),
                outer_timeout,
            )
            usage_obj = getattr(result, "usage", None)
            output = getattr(result, "output", None)
            if isinstance(output, EvalResult):
                last_text = output.model_dump_json()
        except _WatchdogExpired:
            stop_kind = stop_kind or outer_kind
        except RunCancelled:
            if stop_kind is None:
                stop_kind = (
                    "tool_step_budget"
                    if tool_result_count >= config.max_tool_steps
                    else "exception"
                )
        except UsageLimitExceeded as error:
            stop_kind = (
                "tool_step_budget" if "tool" in str(error).lower() else "recursion_limit"
            )
            emit_event(
                {
                    "type": "error",
                    "kind": stop_kind,
                    "message": sanitize_error(str(error)),
                }
            )
            stop_kind = None

        if stop_kind == "wall_timeout":
            emit_event(
                {
                    "type": "error",
                    "kind": "wall_timeout",
                    "message": (
                        "pydantic_ai runner exceeded its wall-clock budget "
                        f"({WALL_TIMEOUT_S:g}s)"
                    ),
                }
            )
        elif stop_kind == "inactivity_timeout":
            emit_event(
                {
                    "type": "error",
                    "kind": "inactivity_timeout",
                    "message": (
                        f"no agent activity for {INACTIVITY_TIMEOUT_S:g}s "
                        "(model or tool call stalled)"
                    ),
                }
            )
        elif stop_kind == "tool_step_budget":
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
        elif stop_kind == "exception":
            emit_event({"type": "error", "kind": "exception", "message": "terminated"})
    except (KeyboardInterrupt, asyncio.CancelledError):
        emit_event({"type": "error", "kind": "exception", "message": "terminated"})
        emit_event({"type": "final", "text": last_text})
        emit_event({"type": "usage", **aggregate_usage(usage_obj)})
        return 1
    except Exception as error:  # noqa: BLE001
        emit_event({"type": "error", "kind": "exception", "message": sanitize_error(str(error))})
        emit_event({"type": "final", "text": last_text})
        emit_event({"type": "usage", **aggregate_usage(usage_obj)})
        return 1
    finally:
        try:
            await _with_optional_timeout(stack.aclose(), CLEANUP_TIMEOUT_S)
        except Exception:  # noqa: BLE001
            pass

    emit_event({"type": "final", "text": last_text})
    emit_event({"type": "usage", **aggregate_usage(usage_obj)})
    return 0


def _map_event(event: object, tool_servers: Mapping[str, str]) -> list[Event]:
    if isinstance(event, FunctionToolCallEvent):
        name = str(event.part.tool_name)
        return [
            {
                "type": "tool_call",
                "id": str(event.part.tool_call_id),
                "name": name,
                "server": tool_servers.get(name),
                "args": _tool_args(event.part),
            }
        ]
    if isinstance(event, FunctionToolResultEvent):
        content = getattr(event.part, "content", None)
        name = str(getattr(event.part, "tool_name", "") or getattr(event, "tool_name", "") or "")
        ok = getattr(event.part, "is_error", False) is not True
        return [
            {
                "type": "tool_result",
                "id": str(event.tool_call_id),
                "name": name,
                "server": tool_servers.get(name),
                "ok": ok,
                "text": flatten_text(content),
                "images": extract_images(content),
                "structured": None,
            }
        ]
    if isinstance(event, PartEndEvent) and isinstance(event.part, ThinkingPart):
        text = thinking_text(event.part)
        if not text:
            return []
        return [
            {
                "type": "assistant",
                "text": "",
                "reasoning": text,
                "tool_calls": [],
                "usage": None,
            }
        ]
    if isinstance(event, PartEndEvent) and isinstance(event.part, TextPart):
        text = event.part.content
        if text:
            return [{"type": "assistant", "text": text, "tool_calls": [], "usage": None}]
    return []


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
