"""Drive run()'s pre-tool hook through a fake `google.antigravity` SDK.

run() imports the SDK lazily, so a fake module tree in sys.modules lets the test
capture the hooks it registers and call them the way the runtime would.
"""

import asyncio
import itertools
import json
import os
import sys
import types as pytypes

import pytest

import run_eval


class FakeHookResult:
    def __init__(self, allow: bool, message: str | None = None) -> None:
        self.allow = allow
        self.message = message


class FakeResponse:
    stop_reason = None

    async def text(self) -> str:
        # Not instantaneous, so a budget stop set during the turn wins the race
        # the way it does live.
        await asyncio.sleep(0.05)
        return 'EVAL_RESULT: {"success":true}'

    async def cancel(self) -> None:
        return None


def install_fake_sdk(monkeypatch, script):
    """`script(config_kwargs, pre_hook)` runs inside agent.chat() and returns nothing."""

    def config_ctor(**kwargs):
        return pytypes.SimpleNamespace(kwargs=kwargs)

    class FakeAgent:
        def __init__(self, config) -> None:
            self.config = config
            self.conversation = pytypes.SimpleNamespace(history=[], total_usage=None)

        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

        async def chat(self, _prompt: str) -> FakeResponse:
            await script(self.config.kwargs, self.config.kwargs["hooks"][0])
            return FakeResponse()

    def identity(fn):
        return fn

    sdk_types = pytypes.SimpleNamespace(
        ToolCall=object,
        HookResult=FakeHookResult,
        McpStdioServer=lambda **kw: kw,
        CapabilitiesConfig=lambda **kw: kw,
        BuiltinTools=pytypes.SimpleNamespace(VIEW_FILE="view_file"),
        BudgetConfig=lambda **kw: kw,
    )
    root = pytypes.ModuleType("google.antigravity")
    root.Agent = FakeAgent
    root.LocalAgentConfig = config_ctor
    root.types = sdk_types
    hooks_mod = pytypes.ModuleType("google.antigravity.hooks")
    hooks_mod.hooks = pytypes.SimpleNamespace(
        pre_tool_call_decide=identity,
        post_tool_call=identity,
        on_tool_error=identity,
    )
    models_mod = pytypes.ModuleType("google.antigravity.models")
    models_mod.GeminiAPIEndpoint = lambda **kw: kw
    models_mod.GeminiModelOptions = lambda **kw: kw
    models_mod.ModelTarget = lambda **kw: kw
    monkeypatch.setitem(sys.modules, "google.antigravity", root)
    monkeypatch.setitem(sys.modules, "google.antigravity.hooks", hooks_mod)
    monkeypatch.setitem(sys.modules, "google.antigravity.models", models_mod)


_ids = itertools.count(1)


def call(name: str, server: str | None = "stagehand", args=None, canonical_path=None):
    return pytypes.SimpleNamespace(
        id=f"c{next(_ids)}",
        name=name,
        server_name=server,
        args=args or {},
        canonical_path=canonical_path,
    )


def run_with(monkeypatch, max_tool_steps, script, mcp_servers=None):
    install_fake_sdk(monkeypatch, script)
    config = run_eval.RunnerConfig(
        prompt="go",
        system_prompt=None,
        model="m",
        max_tool_steps=max_tool_steps,
        mcp_servers=mcp_servers or {},
    )
    return asyncio.run(run_eval.run(config))


def events(capsys):
    return [json.loads(line) for line in capsys.readouterr().out.splitlines()]


def test_view_file_is_free_and_other_tools_count_up_to_the_budget(monkeypatch, capsys):
    decisions: list[tuple[str, bool]] = []

    async def script(config, pre):
        brain = os.path.join(config["app_data_dir"], "brain")
        saved = os.path.join(brain, "c1", ".system_generated", "steps", "3", "output.txt")
        for _ in range(3):  # view_file reads inside brain never touch the budget
            result = await pre(call("view_file", server=None, args={"AbsolutePath": saved}))
            decisions.append(("view_file", result.allow))
        for _ in range(3):
            result = await pre(call("run"))
            decisions.append(("run", result.allow))

    assert run_with(monkeypatch, 2, script) == 0
    # Budget 2: calls 1 and 2 pass, the third (> max) is denied.
    assert decisions == [("view_file", True)] * 3 + [("run", True), ("run", True), ("run", False)]
    out = events(capsys)
    budget = [e for e in out if e["type"] == "error" and e["kind"] == "tool_step_budget"]
    assert len(budget) == 1
    assert "max_tool_steps=2" in budget[0]["message"]


def test_budget_boundary_allows_exactly_max_tool_steps(monkeypatch, capsys):
    decisions: list[bool] = []

    async def script(_config, pre):
        for _ in range(3):
            decisions.append((await pre(call("snapshot"))).allow)

    run_with(monkeypatch, 3, script)
    assert decisions == [True, True, True]
    assert not [e for e in events(capsys) if e.get("kind") == "tool_step_budget"]


def test_view_file_outside_brain_is_denied_and_inside_is_allowed(monkeypatch, capsys, tmp_path):
    decisions: dict[str, bool] = {}
    outside = tmp_path / "secret.txt"
    outside.write_text("nope")

    async def script(config, pre):
        brain = os.path.join(config["app_data_dir"], "brain")
        schema = os.path.join(brain, "conv", "mcp", "stagehand", "run.json")
        cases = {
            "inside_args": call("view_file", None, {"AbsolutePath": schema}),
            "inside_uri": call("view_file", None, {"AbsolutePath": f"file://{schema}#L3"}),
            "inside_canonical": call("view_file", None, {}, canonical_path=schema),
            "outside": call("view_file", None, {"AbsolutePath": str(outside)}),
            "escape": call("view_file", None, {"AbsolutePath": os.path.join(brain, "..", "x")}),
            "canonical_wins": call(
                "view_file", None, {"AbsolutePath": schema}, canonical_path=str(outside)
            ),
            "no_path": call("view_file", None, {"StartLine": 1}),
        }
        for label, tool_call in cases.items():
            decisions[label] = (await pre(tool_call)).allow

    run_with(monkeypatch, 1, script)
    assert decisions == {
        "inside_args": True,
        "inside_uri": True,
        "inside_canonical": True,
        "outside": False,
        "escape": False,
        "canonical_wins": False,
        "no_path": False,
    }
    denied = [e for e in events(capsys) if e["type"] == "tool_result" and e["ok"] is False]
    assert len(denied) == 4
    assert all("view_file may only read" in e["text"] for e in denied)


@pytest.mark.parametrize("server", ["stagehand", None])
def test_a_tool_named_view_file_on_an_mcp_server_still_counts(monkeypatch, capsys, server):
    decisions: list[bool] = []

    async def script(config, pre):
        brain = os.path.join(config["app_data_dir"], "brain")
        args = {"AbsolutePath": os.path.join(brain, "f")}
        for _ in range(2):
            decisions.append((await pre(call("view_file", server=server, args=args))).allow)

    run_with(monkeypatch, 1, script)
    # Only the builtin (no server) is exempt; an MCP tool of the same name is budgeted.
    assert decisions == ([True, False] if server else [True, True])
    capsys.readouterr()


def test_tool_errors_echoing_a_server_env_token_are_redacted(monkeypatch, capsys):
    token = "srv-token-abcdef123456"

    async def script(config, pre):
        _, post, on_error = config["hooks"]
        first = call("run")
        await pre(first)
        await post(
            pytypes.SimpleNamespace(
                id=first.id,
                name="run",
                server_name="stagehand",
                result=None,
                error=f"401 for {token}",
                step_id=None,
            )
        )
        second = call("snapshot")
        await pre(second)
        await on_error(RuntimeError(f"connect failed with {token}"))

    servers = {"stagehand": {"command": "node", "args": [], "env": {"BRIDGE_TOKEN": token}}}
    run_with(monkeypatch, 5, script, servers)
    out = capsys.readouterr().out
    assert token not in out
    results = [json.loads(line) for line in out.splitlines()]
    failed = [e["text"] for e in results if e["type"] == "tool_result" and e["ok"] is False]
    assert failed == ["401 for [redacted]", "RuntimeError: connect failed with [redacted]"]


def test_setup_failure_in_the_fake_sdk_still_emits_terminal_events(monkeypatch, capsys):
    install_fake_sdk(monkeypatch, None)

    def broken(_fn):
        raise RuntimeError("hook registration failed")

    sys.modules["google.antigravity.hooks"].hooks.pre_tool_call_decide = broken
    created: list[str] = []
    real_mkdtemp = run_eval.tempfile.mkdtemp
    monkeypatch.setattr(
        run_eval.tempfile, "mkdtemp", lambda **kw: created.append(real_mkdtemp(**kw)) or created[-1]
    )
    config = run_eval.RunnerConfig(prompt="go", system_prompt=None, model="m")
    assert asyncio.run(run_eval.run(config)) == 1
    out = events(capsys)
    assert [e["type"] for e in out] == ["error", "final", "usage"]
    assert "hook registration failed" in out[0]["message"]
    assert out[2]["reported"] is False
    assert created and not os.path.exists(created[0])
