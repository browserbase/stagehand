import types as pytypes

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
        [{"type": "text", "text": "hello"}, {"type": "image", "data": "QUJD", "mimeType": "image/jpeg"}]
    )
    assert text == "hello"
    assert images == [{"data": "QUJD", "mime_type": "image/jpeg"}]
    assert run_eval.result_payload("plain") == ("plain", [])


def test_usage_event_counts_thoughts_as_output():
    usage = pytypes.SimpleNamespace(
        prompt_token_count=1000,
        cached_content_token_count=800,
        candidates_token_count=100,
        thoughts_token_count=50,
        total_token_count=1150,
    )
    event = run_eval.usage_event(usage)
    assert event["reported"] is True
    assert event["input_tokens"] == 1000
    assert event["cache_read_input_tokens"] == 800
    assert event["output_tokens"] == 150
    assert event["reasoning_output_tokens"] == 50
    assert run_eval.usage_event(None)["reported"] is False


def test_sanitize_error_redacts_google_keys():
    assert "AIza[redacted]" in run_eval.sanitize_error("key AIza" + "x" * 35)


def test_browser_env_forwards_only_browser_credentials():
    env = {"BROWSERBASE_API_KEY": "bb", "STAGEHAND_BROWSER": "browserbase", "GEMINI_API_KEY": "g",
           "BROWSERBASE_PROJECT_ID": "", "PATH": "/bin"}
    assert run_eval.browser_env(env) == {"BROWSERBASE_API_KEY": "bb", "STAGEHAND_BROWSER": "browserbase"}
