from __future__ import annotations

import shutil
import subprocess
import tarfile
import tempfile
import zipfile
from pathlib import Path

SDK_ROOT = Path(__file__).resolve().parents[1]
SERVER_EXTENSION_ROOT = SDK_ROOT.parent / "extension" / "dist"


def main() -> None:
    if not (SERVER_EXTENSION_ROOT / "manifest.json").is_file():
        raise SystemExit("Stagehand extension is not built; run `just build` from the v4/ workspace root.")

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
            ),
        )
        shutil.copytree(
            SERVER_EXTENSION_ROOT,
            staged_sdk / "src" / "stagehand" / "_extension",
        )
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

        with tarfile.open(source_distributions[0], mode="r:gz") as source_distribution:
            if not any(
                member.name.endswith("/src/stagehand/_extension/manifest.json")
                for member in source_distribution.getmembers()
            ):
                raise SystemExit(
                    "Built source distribution does not contain the Stagehand extension"
                )

        output_directory = SDK_ROOT / "dist"
        output_directory.mkdir(exist_ok=True)
        for existing_distribution in (
            *output_directory.glob("stagehand_v4-*.whl"),
            *output_directory.glob("stagehand_v4-*.tar.gz"),
        ):
            existing_distribution.unlink()
        for distribution in (*wheels, *source_distributions):
            shutil.copy2(distribution, output_directory / distribution.name)


if __name__ == "__main__":
    main()
