"""Playwright-style code over Stagehand's page, via the facade's compatibility runtime.

The runtime is `createPlaywrightCompatRuntime` from Stagehand's integrations
package: the same translator the facade's `run` tool uses. It gives agent code
Playwright's page, context and browser objects, and adds Playwright's guardrails
on top of Stagehand's own page: strict-mode errors that list the matching
elements, retries until exactly one element matches, and full error text.

`Stagehand.run(code)` runs code with it. `playwright_batch_source(code)` is the
callback source it passes to `Stagehand.experimental_batch`; it resolves to the
same envelope the facade's `run` tool reads (see `playwright_batch_source`).
"""

from __future__ import annotations

import base64
import binascii
import os
from collections.abc import Mapping
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
  let value;
  let executionError;
  try {
    value = await (async () => {
"""
# Like the facade's `run` epilogue: the code's own error comes back in the envelope,
# so screenshots it took and a `browser.close()` it asked for are still honored.
_TAIL = """
    })();
  } catch (error) {
    executionError = {
      name: typeof error?.name === "string" ? error.name : "Error",
      message: typeof error?.message === "string" ? error.message : String(error),
      ...(typeof error?.stack === "string" ? { stack: error.stack } : {}),
    };
  }
  return {
    value,
    executionError,
    artifacts: runtime.artifacts(),
    closeRequested: runtime.closeRequested(),
  };
}"""


class PlaywrightRunError(RuntimeError):
    """An error thrown by the code passed to `Stagehand.run`, with its JavaScript name and stack."""

    def __init__(self, name: str, message: str, stack: str | None = None) -> None:
        self.name = name
        self.stack = stack
        super().__init__(f"{name}: {message}")


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
    """An `experimental_batch` callback that runs ``code`` with Playwright-shaped globals.

    The callback resolves to ``{"value", "executionError", "artifacts", "closeRequested"}``:
    the code's return value, the error it threw (if any), the screenshots it saved with
    a ``path`` (``{"path", "base64"}``), and whether it called ``browser.close()``.
    Nothing is written or closed inside the browser; `Stagehand.run` does that.
    """
    path = compat_runtime_path()
    if not path.is_file():
        msg = (
            f"Stagehand's Playwright-compatible runtime was not found at {path}; "
            "build the integrations package (the root `just build`) first."
        )
        raise FileNotFoundError(msg)
    runtime = path.read_text(encoding="utf-8").strip()
    return "".join((_HEAD, runtime, _MIDDLE, code, _TAIL))


def write_screenshot_artifacts(
    artifacts: object, artifact_root: str | os.PathLike[str] | None = None
) -> list[Path]:
    """Write screenshots saved with a ``path``, relative to ``artifact_root`` (default: cwd).

    Like the facade, a path must stay within the root, including through symlinks.
    """
    if not isinstance(artifacts, list) or not artifacts:
        return []
    root = Path(artifact_root if artifact_root is not None else Path.cwd())
    root.mkdir(parents=True, exist_ok=True)
    root = root.resolve()
    written: list[Path] = []
    for artifact in artifacts:
        if not isinstance(artifact, Mapping):
            raise ValueError("screenshot artifact must be an object")
        requested = artifact.get("path")
        encoded = artifact.get("base64")
        if not isinstance(requested, str) or not requested or not isinstance(encoded, str):
            raise ValueError("screenshot artifact needs a path and base64 data")
        target = (root / requested).resolve()
        if target == root or not target.is_relative_to(root):
            raise ValueError(
                f"screenshot path {requested!r} must stay within the artifact root {root}"
            )
        try:
            data = base64.b64decode(encoded, validate=True)
        except binascii.Error as error:
            raise ValueError(f"screenshot {requested!r} has invalid base64 data") from error
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
        written.append(target)
    return written
