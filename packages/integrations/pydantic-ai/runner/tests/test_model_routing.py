from dataclasses import replace

from run_eval import RunnerConfig, build_eval_model


def test_model_strings_pass_through() -> None:
    config = RunnerConfig("task", None, "openai:fixture", {}, 10, 5)
    for model in ["openai:fixture", "anthropic:fixture", "google:fixture", "xai:fixture"]:
        assert build_eval_model(replace(config, model=model)) == model
