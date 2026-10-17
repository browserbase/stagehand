"""Antigravity SDK eval runner.

Reads one JSON request on stdin and writes JSONL events on stdout, using the
same event protocol as the Deep Agents runner (assistant / tool_call /
tool_result / final / usage / error) so the evals framework can reuse its
session driver and trajectory adapter:

  {"prompt": str, "system_prompt": str | null, "model": str,
   "mcp_servers": {name: {command, args, env?, cwd?}},
   "max_tool_steps": int, ...}

The agent runs Antigravity's own loop and system prompt (eval instructions
are appended as a section, not a replacement). The mounted MCP servers are the
agent's only way to act.

The Antigravity runtime replaces any tool output larger than about 4 KB with a
notice pointing at a file under its app-data "brain" directory. The one builtin
tool left enabled is therefore view_file, restricted to that directory, so the
agent can read page snapshots and other large outputs. The runner reads the
same files to record the full output as evidence.
"""

from __future__ import annotations

import asyncio
import base64
import glob
import json
import mimetypes
import os
import re
import shutil
import signal
import sys
import tempfile
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


def path_within(path: str, root: str) -> bool:
    """True when `path` (plain path or file:// URI) resolves inside `root`."""
    if path.startswith("file://"):
        path = path[len("file://"):]
    path = path.split("#", 1)[0]
    try:
        real, real_root = os.path.realpath(path), os.path.realpath(root)
    except OSError:
        return False
    return real == real_root or real.startswith(real_root + os.sep)


def view_file_target(call_args: object, canonical_path: str | None) -> str | None:
    """Path a view_file call wants to read."""
    if canonical_path:
        return canonical_path
    if isinstance(call_args, dict):
        for value in call_args.values():
            if isinstance(value, str) and (value.startswith("/") or value.startswith("file://")):
                return value
    return None


def find_offloaded_output(brain_root: str, step_id: str | None, claimed: set[str],
                          not_before: float | None = None) -> str | None:
    """Locate the output.txt the runtime wrote for a tool call, if it offloaded one.

    Files live at <brain>/<conversation>/.system_generated/steps/<n>/output.txt.
    Prefer the file whose step number matches `step_id` ("<trajectory>:<n>").
    Otherwise accept a single unclaimed file only if it was written after the
    call started (`not_before`), so a file left by an earlier call is never
    attributed to this one.
    """
    pattern = os.path.join(glob.escape(brain_root), "*", ".system_generated", "steps", "*", "output.txt")
    candidates = sorted(path for path in glob.glob(pattern) if path not in claimed)
    if not candidates:
        return None
    index = step_id.rsplit(":", 1)[-1] if step_id else None
    chosen = next((p for p in candidates if os.path.basename(os.path.dirname(p)) == index), None)
    if chosen is None and not_before is not None:
        fresh = []
        for path in candidates:
            try:
                if os.path.getmtime(path) >= not_before:
                    fresh.append(path)
            except OSError:
                continue
        if len(fresh) == 1:
            chosen = fresh[0]
    if chosen is not None:
        claimed.add(chosen)
    return chosen


_OFFLOADED_MEDIA = re.compile(r"file://(/[^\s\]\)]+\.(?:png|jpe?g|webp|gif))", re.IGNORECASE)


def offloaded_images(text: str, brain_root: str) -> list[dict[str, str]]:
    """Read images the runtime offloaded ("[Resource offloaded to file://...png]")."""
    images: list[dict[str, str]] = []
    for path in _OFFLOADED_MEDIA.findall(text or ""):
        if not path_within(path, brain_root):
            continue
        try:
            with open(path, "rb") as handle:
                data = handle.read()
        except OSError:
            continue
        images.append({"data": base64.b64encode(data).decode(),
                       "mime_type": mimetypes.guess_type(path)[0] or "image/png"})
    return images


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
    """Map the SDK's cumulative usage onto the cached-subset convention.

    Despite its docstring, the SDK's `prompt_token_count` is net of cached
    tokens (cached regularly exceeds it), and `total_token_count` leaves them
    out too. Report input as prompt + cached so cached is a subset of input.
    Thoughts bill as output.
    """
    if usage is None:
        return {"type": "usage", "reported": False, "input_tokens": 0, "output_tokens": 0,
                "cache_read_input_tokens": 0, "reasoning_output_tokens": 0, "total_tokens": 0}

    def count(name: str) -> int:
        value = getattr(usage, name, None)
        return value if isinstance(value, int) and not isinstance(value, bool) else 0

    cached = count("cached_content_token_count")
    prompt = count("prompt_token_count") + cached
    candidates = count("candidates_token_count")
    thoughts = count("thoughts_token_count")
    return {
        "type": "usage",
        "reported": True,
        "input_tokens": prompt,
        "output_tokens": candidates + thoughts,
        "cache_read_input_tokens": cached,
        "reasoning_output_tokens": thoughts,
        "total_tokens": prompt + candidates + thoughts,
    }


_BUDGET_STOPS = {"MAX_TOOL_CALLS_EXCEEDED", "MAX_MODEL_CALLS_EXCEEDED"}
_VIEW_FILE = "view_file"


class WallTimeout(Exception):
    """The runner's own wall-clock limit expired (not a timeout inside the SDK)."""


async def run(config: RunnerConfig) -> int:
    from google.antigravity import Agent, LocalAgentConfig, types
    from google.antigravity.hooks import hooks
    from google.antigravity.models import GeminiAPIEndpoint, GeminiModelOptions, ModelTarget

    agent_ref: dict[str, Any] = {}
    reported_steps: set[str] = set()
    pending_calls: list[Event] = []
    app_data_dir = tempfile.mkdtemp(prefix="stagehand-antigravity-")
    brain_root = os.path.join(app_data_dir, "brain")
    claimed_outputs: set[str] = set()
    call_started: dict[str, float] = {}
    budget_exhausted = asyncio.Event()
    counted_calls = 0

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
        nonlocal counted_calls
        name = tool_name(data.name)
        call = {"id": str(data.id or ""), "name": name,
                "server": data.server_name, "args": unwrap_hook_args(data.args)}
        if data.server_name is None and name == _VIEW_FILE:
            # Reading saved tool outputs is free; anything else on disk is off limits.
            target = view_file_target(data.args, data.canonical_path)
            if not target or not path_within(target, brain_root):
                message = "view_file may only read tool outputs that were saved to a file."
                reasoning_for(call)
                emit({"type": "tool_call", **call})
                emit({"type": "tool_result", "id": call["id"], "name": name, "server": None,
                      "ok": False, "text": message, "images": [], "structured": None})
                return types.HookResult(allow=False, message=message)
        else:
            counted_calls += 1
            if counted_calls > config.max_tool_steps:
                budget_exhausted.set()
                return types.HookResult(allow=False, message="Tool-call budget exhausted.")
        pending_calls.append(call)
        # 1 s of slack: file mtimes can be coarser than time.time().
        call_started[call["id"]] = time.time() - 1.0
        return types.HookResult(allow=True)

    @hooks.post_tool_call
    async def on_post_tool(data: Any) -> None:
        error = getattr(data, "error", None)
        name = tool_name(getattr(data, "name", ""))
        text, images = result_payload(getattr(data, "result", None))
        if error is None and name != _VIEW_FILE:
            # What the hook sees for an offloaded output is only a title or a
            # pointer; record the real output so the verifier has the evidence.
            saved = find_offloaded_output(brain_root, getattr(data, "step_id", None), claimed_outputs,
                                          call_started.pop(str(getattr(data, "id", "") or ""), None))
            if saved is not None:
                try:
                    with open(saved, encoding="utf-8", errors="replace") as handle:
                        text = handle.read()
                except OSError:
                    pass
            images = images + offloaded_images(text, brain_root)
        complete_call(str(getattr(data, "id", "") or ""), name,
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
        app_data_dir=app_data_dir,
        capabilities=types.CapabilitiesConfig(enabled_tools=[types.BuiltinTools.VIEW_FILE]),
        # The runner enforces the real budget (view_file reads are not counted);
        # the SDK limit is only a backstop.
        budget_config=types.BudgetConfig(max_tool_calls=config.max_tool_steps * 3 + 10),
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
    async def drive(agent: Any) -> None:
        nonlocal final_text
        response = await agent.chat(config.prompt)
        text_task = asyncio.create_task(response.text())
        budget_task = asyncio.create_task(budget_exhausted.wait())
        try:
            done, _ = await asyncio.wait({text_task, budget_task}, timeout=config.wall_timeout_s,
                                         return_when=asyncio.FIRST_COMPLETED)
            budget_hit = budget_task in done and not text_task.done()
            if budget_hit or not done:
                try:
                    await response.cancel()
                except Exception:  # noqa: BLE001 - best effort; the turn is over either way
                    pass
                try:
                    final_text = await asyncio.wait_for(text_task, 30)
                except (Exception, asyncio.CancelledError):  # noqa: BLE001 - a cancelled turn has no text
                    task = asyncio.current_task()
                    if task is not None and task.cancelling():
                        raise  # SIGTERM arrived while winding down; let it through
                    final_text = ""
                if not done:
                    raise WallTimeout
            else:
                final_text = text_task.result()
        finally:
            budget_task.cancel()
            text_task.cancel()
        flush_pending()
        stop = getattr(response.stop_reason, "value", str(response.stop_reason or ""))
        if budget_hit:
            emit({"type": "error", "kind": "tool_step_budget",
                  "message": f"Tool-call budget exhausted (max_tool_steps={config.max_tool_steps})"})
        elif stop in _BUDGET_STOPS:
            emit({"type": "error", "kind": "tool_step_budget",
                  "message": f"Antigravity stopped: {stop} (max_tool_calls={config.max_tool_steps})"})
        elif stop and stop != "UNSPECIFIED":
            emit({"type": "error", "kind": "stop_reason", "message": f"Antigravity stopped: {stop}"})

    # SIGTERM cancels this task so the agent context unwinds and the terminal
    # events below are still written. A handler that raises out of the event
    # loop would skip them.
    current = asyncio.current_task()
    loop = asyncio.get_running_loop()
    if current is not None:
        try:
            loop.add_signal_handler(signal.SIGTERM, current.cancel)
        except (NotImplementedError, RuntimeError, ValueError):
            pass  # not the main thread, or no signal support
    try:
        async with Agent(agent_config) as agent:
            agent_ref["agent"] = agent
            try:
                await drive(agent)
            finally:
                # Read usage while the conversation is still open.
                usage = current_usage()
    except WallTimeout:
        flush_pending()
        emit({"type": "error", "kind": "wall_timeout", "message": f"wall timeout after {config.wall_timeout_s}s"})
    except (KeyboardInterrupt, asyncio.CancelledError):
        flush_pending()
        emit({"type": "error", "kind": "exception", "message": "terminated"})
        emit({"type": "final", "text": final_text})
        emit(usage_event(usage))
        return 1
    except Exception as error:  # noqa: BLE001 - reported to the parent as an event
        flush_pending()
        emit({"type": "error", "kind": "exception", "message": sanitize_error(f"{type(error).__name__}: {error}")})
        emit({"type": "final", "text": final_text})
        emit(usage_event(usage))
        return 1
    finally:
        shutil.rmtree(app_data_dir, ignore_errors=True)
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
