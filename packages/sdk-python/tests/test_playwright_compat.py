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


def test_source_explains_a_missing_runtime(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    _use_runtime(monkeypatch, tmp_path / "missing.js")
    with pytest.raises(FileNotFoundError, match="Playwright-compatible runtime"):
        playwright_compat.playwright_batch_source("return 1;")
