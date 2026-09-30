"""Antigravity SDK eval runner.

Reads one JSON request on stdin and writes JSONL events on stdout, using the
same event protocol as the Deep Agents runner (assistant / tool_call /
tool_result / final / usage / error) so the evals framework can reuse its
session driver and trajectory adapter:

  {"prompt": str, "system_prompt": str | null, "model": str,
   "mcp_servers": {name: {command, args, env?, cwd?}},
   "max_tool_steps": int, ...}

The agent runs Antigravity's own loop and system prompt (eval instructions
are appended as a section, not a replacement). Every builtin tool is disabled
so the mounted MCP servers are the agent's only way to act.
"""

from __future__ import annotations

import asyncio
import base64
import json
import os
import re
import signal
import sys
import time
from dataclasses import dataclass, field
from typing import Any

Event = dict[str, Any]


@dataclass
class RunnerConfig:
    prompt: str
    system_prompt: str | None
    model: str
    mcp_servers: dict[str, dict[str, Any]] = field(default_factory=dict)
    max_tool_steps: int = 50
    thinking_level: str | None = None
    wall_timeout_s: float | None = None


def _require_positive_int(value: object, name: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
        raise ValueError(f"{name} must be a positive integer")
    return value


def normalize_model(model: str) -> str:
    """Strip provider prefixes: google/x, google_genai:x, gemini:x -> x."""
    for prefix in ("google_genai:", "google/", "gemini:"):
        if model.startswith(prefix):
            return model[len(prefix):]
    return model


def parse_config(raw: dict[str, Any], env: dict[str, str] | None = None) -> RunnerConfig:
    env = dict(os.environ) if env is None else env
    prompt = raw.get("prompt")
    if not isinstance(prompt, str) or not prompt:
        raise ValueError("prompt must be a non-empty string")
    model = raw.get("model")
    if not isinstance(model, str) or not model:
        raise ValueError("model must be a non-empty string")
    system_prompt = raw.get("system_prompt")
    if system_prompt is not None and not isinstance(system_prompt, str):
        raise ValueError("system_prompt must be a string or null")
    servers = raw.get("mcp_servers") or {}
    if not isinstance(servers, dict):
        raise ValueError("mcp_servers must be an object")
    for name, server in servers.items():
        if not isinstance(server, dict) or not isinstance(server.get("command"), str):
            raise ValueError(f"mcp server {name!r} needs a command")
        args = server.get("args", [])
        if not isinstance(args, list) or not all(isinstance(a, str) for a in args):
            raise ValueError(f"mcp server {name!r} args must be strings")
    thinking = env.get("EVAL_ANTIGRAVITY_THINKING_LEVEL") or None
    wall = env.get("EVAL_ANTIGRAVITY_WALL_TIMEOUT_S")
    return RunnerConfig(
        prompt=prompt,
        system_prompt=system_prompt or None,
        model=normalize_model(model),
        mcp_servers=servers,
        max_tool_steps=_require_positive_int(raw.get("max_tool_steps", 50), "max_tool_steps"),
        thinking_level=thinking,
        wall_timeout_s=float(wall) if wall else None,
    )


def resolve_api_key(env: dict[str, str] | None = None) -> str | None:
    env = dict(os.environ) if env is None else env
    for key in ("GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY"):
        if env.get(key):
            return env[key]
    return None


def browser_env(env: dict[str, str] | None = None) -> dict[str, str]:
    """Browser credentials for the MCP child.

    The Antigravity runtime starts MCP servers with a reduced environment, so
    the facade would not see Browserbase credentials. Forward only non-empty
    STAGEHAND_* and BROWSERBASE_* variables, as the other harnesses do.
    """
    env = dict(os.environ) if env is None else env
    return {k: v for k, v in env.items() if v and k.startswith(("STAGEHAND_", "BROWSERBASE_"))}


def sanitize_error(message: str) -> str:
    for name, value in os.environ.items():
        if len(value) >= 6 and re.search(
            r"(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|AUTH)", name, re.IGNORECASE
        ):
            message = message.replace(value, "[redacted]")
    message = re.sub(r"\bAIza[0-9A-Za-z_-]{30,}", "AIza[redacted]", message)
    message = re.sub(r"\b(bb_(?:live|test)_[A-Za-z0-9]{4})[A-Za-z0-9_-]+", r"\1[redacted]", message)
    return re.sub(r"\b(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}", r"\1[redacted]", message, flags=re.I)


def print_line(event: Event) -> None:
    sys.stdout.write(json.dumps(event, separators=(",", ":"), default=str) + "\n")
    sys.stdout.flush()


def unwrap_hook_args(args: object) -> dict[str, Any]:
    """Pre-tool hooks see MCP calls wrapped as {Arguments, ServerName, ToolName}."""
    if isinstance(args, dict) and isinstance(args.get("Arguments"), dict):
        return args["Arguments"]
    return args if isinstance(args, dict) else {}


def result_payload(result: object) -> tuple[str, list[dict[str, str]]]:
    """Split a tool result into text and inline images ({data, mime_type})."""
    texts: list[str] = []
    images: list[dict[str, str]] = []

    def visit(value: object) -> None:
        if value is None:
            return
        if isinstance(value, str):
            texts.append(value)
            return
        if isinstance(value, (bytes, bytearray)):
            images.append({"data": base64.b64encode(value).decode(), "mime_type": "image/png"})
            return
        if isinstance(value, list):
            for item in value:
                visit(item)
            return
        if isinstance(value, dict):
            kind = value.get("type")
            if kind == "image" and isinstance(value.get("data"), str):
                images.append(
                    {"data": value["data"], "mime_type": str(value.get("mimeType") or value.get("mime_type") or "image/png")}
                )
                return
            if kind == "text" and isinstance(value.get("text"), str):
                texts.append(value["text"])
                return
            if "content" in value and isinstance(value["content"], list):
                visit(value["content"])
                return
            texts.append(json.dumps(value, default=str))
            return
        data = getattr(value, "data", None)
        mime = getattr(value, "mime_type", None)
        if isinstance(data, (bytes, bytearray)) and isinstance(mime, str) and mime.startswith("image/"):
            images.append({"data": base64.b64encode(data).decode(), "mime_type": mime})
            return
        texts.append(str(value))

    visit(result)
    return "\n".join(texts), images


def usage_event(usage: object) -> Event:
    """Gemini counters: prompt includes cached tokens; thoughts bill as output."""
    if usage is None:
        return {"type": "usage", "reported": False, "input_tokens": 0, "output_tokens": 0,
                "cache_read_input_tokens": 0, "reasoning_output_tokens": 0, "total_tokens": 0}

    def count(name: str) -> int:
        value = getattr(usage, name, None)
        return value if isinstance(value, int) and not isinstance(value, bool) else 0

    prompt = count("prompt_token_count")
    candidates = count("candidates_token_count")
    thoughts = count("thoughts_token_count")
    return {
        "type": "usage",
        "reported": True,
        "input_tokens": prompt,
        "output_tokens": candidates + thoughts,
        "cache_read_input_tokens": count("cached_content_token_count"),
        "reasoning_output_tokens": thoughts,
        "total_tokens": count("total_token_count") or prompt + candidates + thoughts,
    }


_BUDGET_STOPS = {"MAX_TOOL_CALLS_EXCEEDED", "MAX_MODEL_CALLS_EXCEEDED"}


async def run(config: RunnerConfig) -> int:
    from google.antigravity import Agent, LocalAgentConfig, types
    from google.antigravity.hooks import hooks
    from google.antigravity.models import GeminiAPIEndpoint, GeminiModelOptions, ModelTarget

    agent_ref: dict[str, Any] = {}
    reported_steps: set[str] = set()
    pending_calls: list[Event] = []

    def emit(event: Event) -> None:
        print_line({**event, "ts": time.time()})

    def tool_name(value: object) -> str:
        return str(getattr(value, "value", value) or "")

    def reasoning_for(call: Event) -> None:
        """Emit the model text/thinking of the step that issued `call`, once.

        History holds one entry per streamed update; the last entry per step
        id is the complete one. Prefer the step whose tool call matches this
        call's name and args, else the oldest unreported model step.
        """
        agent = agent_ref.get("agent")
        if agent is None:
            return
        try:
            history = list(agent.conversation.history)
        except Exception:
            return
        latest: dict[str, Any] = {}
        for step in history:
            if getattr(step.source, "value", "") == "MODEL":
                latest[step.id or str(step.step_index)] = step
        unreported = [(sid, st) for sid, st in latest.items() if sid not in reported_steps]
        match = next(
            (
                (sid, st)
                for sid, st in unreported
                if any(tool_name(c.name) == call["name"] and (c.args or {}) == call["args"] for c in st.tool_calls)
            ),
            unreported[0] if unreported else None,
        )
        if match is None:
            return
        # Earlier unreported steps (text-only turns) are folded in order too.
        for sid, step in unreported:
            reported_steps.add(sid)
            text, thinking = step.content or "", step.thinking or ""
            if text or thinking:
                emit({"type": "assistant", "text": text, "reasoning": thinking, "tool_calls": []})
            if sid == match[0]:
                break

    def take_pending(call_id: str, name: str) -> Event | None:
        for index, call in enumerate(pending_calls):
            if call_id and call["id"] == call_id:
                return pending_calls.pop(index)
        for index, call in enumerate(pending_calls):
            if call["name"] == name:
                return pending_calls.pop(index)
        return pending_calls.pop(0) if pending_calls else None

    def complete_call(call_id: str, name: str, server: str | None, ok: bool, text: str,
                      images: list[dict[str, str]]) -> None:
        call = take_pending(call_id, name) or {"id": call_id, "name": name, "server": server, "args": {}}
        reasoning_for(call)
        emit({"type": "tool_call", **call})
        emit({"type": "tool_result", "id": call["id"], "name": call["name"],
              "server": server or call.get("server"), "ok": ok, "text": text,
              "images": images, "structured": None})

    @hooks.pre_tool_call_decide
    async def on_pre_tool(data: types.ToolCall) -> types.HookResult:
        pending_calls.append({"id": str(data.id or ""), "name": tool_name(data.name),
                              "server": data.server_name, "args": unwrap_hook_args(data.args)})
        return types.HookResult(allow=True)

    @hooks.post_tool_call
    async def on_post_tool(data: Any) -> None:
        error = getattr(data, "error", None)
        text, images = result_payload(getattr(data, "result", None))
        complete_call(str(getattr(data, "id", "") or ""), tool_name(getattr(data, "name", "")),
                      getattr(data, "server_name", None), error is None,
                      sanitize_error(str(error)) if error else text, images)

    @hooks.on_tool_error
    async def on_tool_error(data: Exception) -> None:
        call_id = str(getattr(data, "call_id", "") or getattr(data, "id", "") or "")
        name = tool_name(getattr(data, "tool_name", "") or getattr(data, "name", ""))
        complete_call(call_id, name, None, False, sanitize_error(f"{type(data).__name__}: {data}"), [])
        return None  # let the SDK report the error to the model as usual

    def flush_pending() -> None:
        while pending_calls:
            call = pending_calls.pop(0)
            reasoning_for(call)
            emit({"type": "tool_call", **call})

    options = GeminiModelOptions(thinking_level=config.thinking_level) if config.thinking_level else None
    target = ModelTarget(name=config.model, endpoint=GeminiAPIEndpoint(api_key=resolve_api_key(), options=options))
    servers = [
        types.McpStdioServer(name=name, command=server["command"], args=list(server.get("args", [])),
                             env={**browser_env(), **(server.get("env") or {})})
        for name, server in config.mcp_servers.items()
    ]
    agent_config = LocalAgentConfig(
        model=target,
        mcp_servers=servers,
        capabilities=types.CapabilitiesConfig(enabled_tools=[]),
        budget_config=types.BudgetConfig(max_tool_calls=config.max_tool_steps),
        hooks=[on_pre_tool, on_post_tool, on_tool_error],
        **({"system_instructions": config.system_prompt} if config.system_prompt else {}),
    )

    final_text = ""
    usage: object = None

    def current_usage() -> object:
        agent = agent_ref.get("agent")
        try:
            return agent.conversation.total_usage if agent is not None else None
        except Exception:
            return None
    try:
        async with Agent(agent_config) as agent:
            agent_ref["agent"] = agent

            async def converse() -> Any:
                response = await agent.chat(config.prompt)
                text = await response.text()
                return response, text

            if config.wall_timeout_s:
                response, final_text = await asyncio.wait_for(converse(), config.wall_timeout_s)
            else:
                response, final_text = await converse()
            flush_pending()
            usage = agent.conversation.total_usage
            stop = getattr(response.stop_reason, "value", str(response.stop_reason or ""))
            if stop in _BUDGET_STOPS:
                emit({"type": "error", "kind": "tool_step_budget",
                      "message": f"Antigravity stopped: {stop} (max_tool_calls={config.max_tool_steps})"})
            elif stop and stop != "UNSPECIFIED":
                emit({"type": "error", "kind": "stop_reason", "message": f"Antigravity stopped: {stop}"})
    except asyncio.TimeoutError:
        flush_pending()
        emit({"type": "error", "kind": "wall_timeout", "message": f"wall timeout after {config.wall_timeout_s}s"})
        usage = current_usage()
    except KeyboardInterrupt:
        flush_pending()
        emit({"type": "error", "kind": "exception", "message": "terminated"})
        emit({"type": "final", "text": final_text})
        emit(usage_event(usage or current_usage()))
        return 1
    except Exception as error:  # noqa: BLE001 - reported to the parent as an event
        flush_pending()
        emit({"type": "error", "kind": "exception", "message": sanitize_error(f"{type(error).__name__}: {error}")})
        emit({"type": "final", "text": final_text})
        emit(usage_event(usage or current_usage()))
        return 1
    emit({"type": "final", "text": final_text})
    emit(usage_event(usage))
    return 0


def _terminated(_signum: int, _frame: object) -> None:
    raise KeyboardInterrupt


def main() -> int:
    signal.signal(signal.SIGTERM, _terminated)
    try:
        config = parse_config(json.loads(sys.stdin.read()))
    except (json.JSONDecodeError, ValueError, TypeError) as error:
        print_line({"type": "error", "kind": "config", "message": sanitize_error(str(error)), "ts": time.time()})
        return 2
    try:
        return asyncio.run(run(config))
    except KeyboardInterrupt:
        print_line({"type": "error", "kind": "exception", "message": "terminated", "ts": time.time()})
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
