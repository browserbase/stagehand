from __future__ import annotations

import shutil
import subprocess
import tarfile
import tempfile
import zipfile
from pathlib import Path

SDK_ROOT = Path(__file__).resolve().parents[1]
EXTENSION_ROOT = SDK_ROOT.parent / "extension" / "dist"
# The facade's Playwright-compatible runtime, emitted by the integrations package build.
COMPAT_RUNTIME = SDK_ROOT.parent / "integrations" / "core" / "dist" / "playwright-compat.js"
COMPAT_ASSET = "_playwright_compat.js"


def clean_distribution_directory(output_directory: Path) -> None:
    for pattern in (
        "stagehand-*.whl",
        "stagehand-*.tar.gz",
        "stagehand_v4-*.whl",
        "stagehand_v4-*.tar.gz",
    ):
        for existing_distribution in output_directory.glob(pattern):
            existing_distribution.unlink()


def main() -> None:
    if not (EXTENSION_ROOT / "manifest.json").is_file():
        raise SystemExit("Stagehand extension is not built; run the root `just build` command.")
    if not COMPAT_RUNTIME.is_file():
        raise SystemExit(
            "Playwright-compatible runtime is not built; run the root `just build` command."
        )

    with tempfile.TemporaryDirectory(prefix="stagehand-python-build-") as temporary_directory:
        temporary_root = Path(temporary_directory)
        staged_sdk = temporary_root / "sdk-python"
        built_distributions = temporary_root / "dist"
        shutil.copytree(
            SDK_ROOT,
            staged_sdk,
            ignore=shutil.ignore_patterns(
                ".pytest_cache",
                ".ruff_cache",
                ".venv",
                "__pycache__",
                "dist",
                "_extension",
                COMPAT_ASSET,
            ),
        )
        shutil.copytree(
            EXTENSION_ROOT,
            staged_sdk / "src" / "stagehand" / "_extension",
        )
        shutil.copy2(COMPAT_RUNTIME, staged_sdk / "src" / "stagehand" / COMPAT_ASSET)
        subprocess.run(
            [
                "uv",
                "build",
                "--no-sources",
                "--out-dir",
                str(built_distributions),
                str(staged_sdk),
            ],
            check=True,
        )

        wheels = list(built_distributions.glob("*.whl"))
        source_distributions = list(built_distributions.glob("*.tar.gz"))
        if len(wheels) != 1 or len(source_distributions) != 1:
            raise SystemExit("Expected uv to build exactly one wheel and one source distribution")

        with zipfile.ZipFile(wheels[0]) as wheel:
            if "stagehand/_extension/manifest.json" not in wheel.namelist():
                raise SystemExit("Built wheel does not contain the Stagehand extension")
            if f"stagehand/{COMPAT_ASSET}" not in wheel.namelist():
                raise SystemExit("Built wheel does not contain the Playwright-compatible runtime")

        with tarfile.open(source_distributions[0], mode="r:gz") as source_distribution:
            if not any(
                member.name.endswith("/src/stagehand/_extension/manifest.json")
                for member in source_distribution.getmembers()
            ):
                raise SystemExit(
                    "Built source distribution does not contain the Stagehand extension"
                )
            if not any(
                member.name.endswith(f"/src/stagehand/{COMPAT_ASSET}")
                for member in source_distribution.getmembers()
            ):
                raise SystemExit(
                    "Built source distribution does not contain the Playwright-compatible runtime"
                )

        output_directory = SDK_ROOT / "dist"
        output_directory.mkdir(exist_ok=True)
        clean_distribution_directory(output_directory)
        for distribution in (*wheels, *source_distributions):
            shutil.copy2(distribution, output_directory / distribution.name)


if __name__ == "__main__":
    main()
