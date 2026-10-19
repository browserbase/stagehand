import base64
from pathlib import Path

import pytest

from stagehand import playwright_compat


def _use_runtime(monkeypatch: pytest.MonkeyPatch, path: Path) -> None:
    monkeypatch.setattr(playwright_compat, "compat_runtime_path", lambda: path)


def test_source_wraps_code_with_playwright_shaped_page_context_and_browser(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    runtime = tmp_path / "playwright-compat.js"
    runtime.write_text("async function createPlaywrightCompatRuntime(stagehand) {}")
    _use_runtime(monkeypatch, runtime)

    source = playwright_compat.playwright_batch_source("return await page.title();")

    assert source.startswith("async (batch, input) => {")
    assert "const createRuntime = async function createPlaywrightCompatRuntime(" in source
    assert "await createRuntime(batch, { hiddenPageIds: [] })" in source
    for name in ("page", "context", "browser"):
        assert f"const {name} = runtime.{name};" in source
    assert "return await page.title();" in source
    for field in ("executionError,", "artifacts: runtime.artifacts(),", "closeRequested:"):
        assert field in source


def test_source_explains_a_missing_runtime(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    _use_runtime(monkeypatch, tmp_path / "missing.js")
    with pytest.raises(FileNotFoundError, match="Playwright-compatible runtime"):
        playwright_compat.playwright_batch_source("return 1;")


def test_screenshots_are_written_relative_to_the_artifact_root(tmp_path: Path) -> None:
    data = base64.b64encode(b"image").decode()
    written = playwright_compat.write_screenshot_artifacts(
        [{"path": "a/b.png", "base64": data}], tmp_path
    )
    assert written == [(tmp_path / "a" / "b.png").resolve()]
    assert (tmp_path / "a" / "b.png").read_bytes() == b"image"


@pytest.mark.parametrize("requested", ["../outside.png", "/tmp/absolute.png", ".", "link/x.png"])
def test_screenshot_paths_must_stay_within_the_artifact_root(
    tmp_path: Path, requested: str
) -> None:
    root = tmp_path / "root"
    root.mkdir()
    (root / "link").symlink_to(tmp_path, target_is_directory=True)
    data = base64.b64encode(b"image").decode()
    with pytest.raises(ValueError, match="artifact root"):
        playwright_compat.write_screenshot_artifacts([{"path": requested, "base64": data}], root)
