import io
import json
import os
import subprocess
import sys
import types as pytypes

import pydantic
import pytest

import run_eval


def test_parse_config_strips_provider_prefix_and_reads_env_knobs():
    config = run_eval.parse_config(
        {"prompt": "go", "model": "google_genai:gemini-3.8-flash", "max_tool_steps": 7},
        env={"EVAL_ANTIGRAVITY_THINKING_LEVEL": "high", "EVAL_ANTIGRAVITY_WALL_TIMEOUT_S": "30"},
    )
    assert config.model == "gemini-3.8-flash"
    assert config.max_tool_steps == 7
    assert config.thinking_level == "high"
    assert config.wall_timeout_s == 30.0


def test_thinking_level_is_stripped_and_validated_against_the_sdk():
    from google.antigravity.models import ThinkingLevel

    assert run_eval.parse_thinking_level(" High ") == "high"
    assert run_eval.parse_thinking_level("extra_high") == "extra_high"
    assert run_eval.parse_thinking_level("  ") is None
    assert run_eval.parse_thinking_level(None) is None
    for level in ThinkingLevel:
        assert run_eval.parse_thinking_level(level.value) == level.value
    with pytest.raises(ValueError, match="EVAL_ANTIGRAVITY_THINKING_LEVEL"):
        run_eval.parse_thinking_level("max")


def test_main_reports_a_bad_thinking_level_as_a_config_error(monkeypatch, capsys):
    monkeypatch.setenv("EVAL_ANTIGRAVITY_THINKING_LEVEL", "ultra")
    monkeypatch.setattr(run_eval.sys, "stdin", io.StringIO('{"prompt": "go", "model": "m"}'))
    assert run_eval.main() == 2
    events = [json.loads(line) for line in capsys.readouterr().out.splitlines()]
    assert [(e["type"], e["kind"]) for e in events] == [("error", "config")]
    assert "EVAL_ANTIGRAVITY_THINKING_LEVEL" in events[0]["message"]


def test_budget_stop_message_names_the_real_sdk_backstop():
    assert run_eval.sdk_tool_call_backstop(50) == 160
    message = run_eval.budget_stop_message("MAX_TOOL_CALLS_EXCEEDED", 50)
    assert "160 tool calls including view_file" in message
    assert "runner budget 50" in message
    assert run_eval.budget_stop_message("MAX_MODEL_CALLS_EXCEEDED", 50) == (
        "Antigravity stopped: MAX_MODEL_CALLS_EXCEEDED"
    )


@pytest.mark.parametrize(
    "raw",
    [
        {"model": "m"},
        {"prompt": "go"},
        {"prompt": "go", "model": "m", "max_tool_steps": 0},
        {"prompt": "go", "model": "m", "mcp_servers": {"s": {"args": []}}},
    ],
)
def test_parse_config_rejects_invalid_requests(raw):
    with pytest.raises(ValueError):
        run_eval.parse_config(raw, env={})


def test_api_key_falls_back_to_google_names():
    assert run_eval.resolve_api_key({"GOOGLE_API_KEY": "k1"}) == "k1"
    assert run_eval.resolve_api_key({"GEMINI_API_KEY": "k0", "GOOGLE_API_KEY": "k1"}) == "k0"
    assert run_eval.resolve_api_key({}) is None


def test_unwrap_hook_args():
    wrapped = {"Arguments": {"a": 1}, "ServerName": "s", "ToolName": "t"}
    assert run_eval.unwrap_hook_args(wrapped) == {"a": 1}
    assert run_eval.unwrap_hook_args({"a": 2}) == {"a": 2}
    assert run_eval.unwrap_hook_args(None) == {}


def test_result_payload_splits_text_and_images():
    text, images = run_eval.result_payload(
        [
            {"type": "text", "text": "hello"},
            {"type": "image", "data": "QUJD", "mimeType": "image/jpeg"},
        ]
    )
    assert text == "hello"
    assert images == [{"data": "QUJD", "mime_type": "image/jpeg"}]
    assert run_eval.result_payload("plain") == ("plain", [])


def test_usage_event_on_recorded_run_where_cached_exceeds_net_prompt():
    # Recorded run: gemini-4-argon on HardBench task 042fce39001b44c6 (2026-11-18,
    # SDK 0.1.20). Raw SDK fields are not persisted, so they are reconstructed
    # from the runner's emitted usage event in that trajectory
    # (input 4_323_999, cached 4_093_431, output 17_995, reasoning 7_285):
    # prompt_token_count = input - cached, candidates = output - reasoning, and
    # total_token_count = prompt + candidates + thoughts (cached left out).
    # Cached (4.09M) is ~18x the net prompt count (230_568).
    usage = pytypes.SimpleNamespace(
        prompt_token_count=230_568,
        cached_content_token_count=4_093_431,
        candidates_token_count=10_710,
        thoughts_token_count=7_285,
        total_token_count=248_563,
    )
    event = run_eval.usage_event(usage)
    assert event == {
        "type": "usage",
        "reported": True,
        "input_tokens": 4_323_999,
        "output_tokens": 17_995,
        "cache_read_input_tokens": 4_093_431,
        "reasoning_output_tokens": 7_285,
        "total_tokens": 4_341_994,
    }


def test_usage_event_is_unreported_without_a_model_response():
    assert run_eval.usage_event(None)["reported"] is False
    # What total_usage returns before any model response: every count is None.
    from google.antigravity import types

    empty = types.UsageMetadata()
    assert all(getattr(empty, name) is None for name in run_eval._USAGE_COUNT_FIELDS)
    event = run_eval.usage_event(empty)
    assert event["reported"] is False
    assert event["input_tokens"] == event["output_tokens"] == 0
    # One real count is enough to report.
    partial = pytypes.SimpleNamespace(prompt_token_count=0)
    assert run_eval.usage_event(partial)["reported"] is True


def test_sanitize_error_redacts_google_keys():
    assert "AIza[redacted]" in run_eval.sanitize_error("key AIza" + "x" * 35)


def test_browser_env_forwards_only_browser_credentials():
    env = {
        "BROWSERBASE_API_KEY": "bb",
        "STAGEHAND_BROWSER": "browserbase",
        "GEMINI_API_KEY": "g",
        "BROWSERBASE_PROJECT_ID": "",
        "PATH": "/bin",
    }
    assert run_eval.browser_env(env) == {
        "BROWSERBASE_API_KEY": "bb",
        "STAGEHAND_BROWSER": "browserbase",
    }


def test_path_within_handles_uris_fragments_and_escapes(tmp_path):
    root = tmp_path / "brain"
    saved = root / "c1" / ".system_generated" / "steps" / "4" / "output.txt"
    saved.parent.mkdir(parents=True)
    saved.write_text("x")
    assert run_eval.path_within(str(saved), str(root))
    assert run_eval.path_within(f"file://{saved}#L20", str(root))
    assert not run_eval.path_within("/etc/hosts", str(root))
    assert not run_eval.path_within(str(root / ".." / "secrets.txt"), str(root))
    assert not run_eval.path_within(str(tmp_path / "brain-other" / "f"), str(root))


def test_view_file_target_prefers_canonical_path():
    assert run_eval.view_file_target({"AbsolutePath": "/a/b"}, "/c/d") == "/c/d"
    assert (
        run_eval.view_file_target({"StartLine": 1, "AbsolutePath": "file:///a/b"}, None)
        == "file:///a/b"
    )
    assert run_eval.view_file_target({"StartLine": 1}, None) is None


def test_find_offloaded_output_matches_step_and_claims(tmp_path):
    root = tmp_path / "brain"
    paths = {}
    for step in ("4", "9"):
        path = root / "conv" / ".system_generated" / "steps" / step / "output.txt"
        path.parent.mkdir(parents=True)
        path.write_text(step)
        paths[step] = str(path)
    claimed: set[str] = set()
    assert run_eval.find_offloaded_output(str(root), "traj:9", claimed) == paths["9"]
    # One unclaimed file left, written after this call started: unambiguous
    # even when the step number is unknown.
    assert run_eval.find_offloaded_output(str(root), None, claimed, not_before=0.0) == paths["4"]
    assert run_eval.find_offloaded_output(str(root), "traj:4", claimed) is None


def test_find_offloaded_output_ignores_files_older_than_the_call(tmp_path):
    root = tmp_path / "brain"
    stale = root / "conv" / ".system_generated" / "steps" / "4" / "output.txt"
    stale.parent.mkdir(parents=True)
    stale.write_text("left by an earlier call")
    later = stale.stat().st_mtime + 60
    assert run_eval.find_offloaded_output(str(root), "traj:7", set(), not_before=later) is None
    # Without a start time there is nothing to tie the file to this call.
    assert run_eval.find_offloaded_output(str(root), "traj:7", set()) is None
    # A matching step number is enough on its own.
    assert run_eval.find_offloaded_output(str(root), "traj:4", set(), not_before=later) == str(
        stale
    )


def test_find_offloaded_output_is_none_when_ambiguous(tmp_path):
    root = tmp_path / "brain"
    for step in ("4", "9"):
        path = root / "conv" / ".system_generated" / "steps" / step / "output.txt"
        path.parent.mkdir(parents=True)
        path.write_text(step)
    # Two fresh unclaimed files and no step match: nothing to tie to this call.
    assert run_eval.find_offloaded_output(str(root), "traj:2", set(), not_before=0.0) is None


def test_offloaded_images_reads_only_inside_brain(tmp_path):
    root = tmp_path / "brain"
    media = root / "conv" / ".system_generated" / "steps" / "3" / "media_0.png"
    media.parent.mkdir(parents=True)
    media.write_bytes(b"PNG")
    outside = tmp_path / "other.png"
    outside.write_bytes(b"NO")
    text = f"[Resource offloaded to file://{media}] and file://{outside}"
    assert run_eval.offloaded_images(text, str(root)) == [
        {"data": "UE5H", "mime_type": "image/png"}
    ]


@pytest.mark.parametrize("raw", [[], "go", 3, None])
def test_parse_config_rejects_non_object_requests(raw):
    with pytest.raises(ValueError, match="JSON object"):
        run_eval.parse_config(raw, env={})


@pytest.mark.parametrize(
    "server",
    [
        {"command": "node", "env": {"A": 1}},
        {"command": "node", "env": ["A=1"]},
        {"command": "node", "cwd": 3},
        {"command": "node", "cwd": ""},
    ],
)
def test_parse_config_rejects_bad_server_env_and_cwd(server):
    with pytest.raises(ValueError):
        run_eval.parse_config({"prompt": "go", "model": "m", "mcp_servers": {"s": server}}, env={})


@pytest.mark.parametrize("stdin", ["[]", '"go"', "not json"])
def test_main_reports_a_config_error_event_for_bad_requests(monkeypatch, capsys, stdin):
    monkeypatch.setattr(run_eval.sys, "stdin", io.StringIO(stdin))
    assert run_eval.main() == 2
    events = [json.loads(line) for line in capsys.readouterr().out.splitlines()]
    assert len(events) == 1
    assert events[0]["type"] == "error"
    assert events[0]["kind"] == "config"


def test_result_payload_reads_content_blocks_of_object_results():
    # MCP SDK results are pydantic models: CallToolResult(content=[TextContent, ImageContent]).
    class Block(pydantic.BaseModel):
        type: str
        text: str | None = None
        data: str | None = None
        mimeType: str | None = None

    class CallToolResult(pydantic.BaseModel):
        content: list[Block]
        isError: bool = False

    result = CallToolResult(
        content=[
            Block(type="text", text="short output"),
            Block(type="image", data="QUJD", mimeType="image/png"),
        ]
    )
    assert run_eval.result_payload(result) == (
        "short output",
        [{"data": "QUJD", "mime_type": "image/png"}],
    )

    # A plain object with the same shape reads the same way.
    plain = pytypes.SimpleNamespace(
        content=[
            pytypes.SimpleNamespace(type="text", text="hi"),
            {"type": "image", "data": "WFla", "mime_type": "image/jpeg"},
        ]
    )
    assert run_eval.result_payload(plain) == ("hi", [{"data": "WFla", "mime_type": "image/jpeg"}])

    # A dict-shaped result, and an embedded text resource.
    assert run_eval.result_payload(
        {
            "content": [
                {"type": "text", "text": "a"},
                {"type": "resource", "resource": {"uri": "x://y", "text": "b"}},
            ],
            "isError": False,
        }
    ) == ("a\nb", [])


def test_result_payload_keeps_sdk_media_and_serializes_other_models():
    from google.antigravity import types

    image = types.Image(data=b"PNG", mime_type="image/png")
    assert run_eval.result_payload(image) == ("", [{"data": "UE5H", "mime_type": "image/png"}])

    class Other(pydantic.BaseModel):
        count: int

    assert run_eval.result_payload(Other(count=2)) == ('{"count": 2}', [])


def test_stdio_server_spec_merges_browser_env_and_passes_command_through_without_cwd():
    spec = run_eval.stdio_server_spec(
        {"command": "node", "args": ["facade.js"], "env": {"STAGEHAND_BROWSER": "local"}},
        env={"BROWSERBASE_API_KEY": "bb", "STAGEHAND_BROWSER": "browserbase", "PATH": "/bin"},
    )
    assert spec == {
        "command": "node",
        "args": ["facade.js"],
        "env": {"BROWSERBASE_API_KEY": "bb", "STAGEHAND_BROWSER": "local"},
    }


def test_stdio_server_spec_runs_the_server_in_its_cwd(tmp_path):
    spec = run_eval.stdio_server_spec(
        {
            "command": sys.executable,
            "args": ["-c", "import os; print(os.getcwd())"],
            "cwd": str(tmp_path),
        },
        env={},
    )
    assert spec["command"] == sys.executable
    out = subprocess.run(
        [spec["command"], *spec["args"]], capture_output=True, text=True, check=True
    )
    assert os.path.realpath(out.stdout.strip()) == os.path.realpath(tmp_path)


def test_stdio_server_spec_builds_a_valid_sdk_server(tmp_path):
    from google.antigravity import types

    server = types.McpStdioServer(
        name="stagehand",
        **run_eval.stdio_server_spec(
            {"command": "node", "args": ["a.js"], "cwd": str(tmp_path)}, env={}
        ),
    )
    assert server.args[-2:] == ["node", "a.js"]
    assert str(tmp_path) in server.args
