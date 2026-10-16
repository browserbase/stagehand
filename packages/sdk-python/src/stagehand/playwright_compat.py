"""Playwright-style code over Stagehand's page, via the facade's compatibility runtime.

The runtime is `createPlaywrightCompatRuntime` from Stagehand's integrations
package: the same translator the facade's `run` tool uses. It gives agent code
Playwright's page, context and browser objects, and adds Playwright's guardrails
on top of Stagehand's own page: strict-mode errors that list the matching
elements, retries until exactly one element matches, and full error text.

Run code with it by passing `playwright_batch_source(code)` to
`Stagehand.experimental_batch`.
"""

from __future__ import annotations

from pathlib import Path

_ASSET_NAME = "_playwright_compat.js"

# The runtime is built with esbuild's keepNames, so it calls `__name`.
_HEAD = """async (batch, input) => {
  "use strict";
  const __stagehandCompatIdentity = (target) => target;
  for (let index = 0; index <= 32; index += 1) {
    globalThis[index === 0 ? "__name" : "__name" + index] = __stagehandCompatIdentity;
  }
  const createRuntime = """
_MIDDLE = """;
  const runtime = await createRuntime(batch, { hiddenPageIds: [] });
  const page = runtime.page;
  const context = runtime.context;
  const browser = runtime.browser;
  return await (async () => {
"""
_TAIL = """
  })();
}"""


def compat_runtime_path() -> Path:
    """Where the runtime is: bundled in the wheel, or built in a monorepo checkout."""
    bundled = Path(__file__).with_name(_ASSET_NAME)
    if bundled.is_file():
        return bundled
    return (
        Path(__file__).resolve().parents[3]
        / "integrations"
        / "core"
        / "dist"
        / "playwright-compat.js"
    )


def playwright_batch_source(code: str) -> str:
    """An `experimental_batch` callback that runs ``code`` with Playwright-shaped globals."""
    path = compat_runtime_path()
    if not path.is_file():
        msg = (
            f"Stagehand's Playwright-compatible runtime was not found at {path}; "
            "build the integrations package (the root `just build`) first."
        )
        raise FileNotFoundError(msg)
    runtime = path.read_text(encoding="utf-8").strip()
    return "".join((_HEAD, runtime, _MIDDLE, code, _TAIL))
