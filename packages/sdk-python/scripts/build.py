from __future__ import annotations

import hashlib
import json
import re
import shutil
import subprocess
import tarfile
import tempfile
import zipfile
from pathlib import Path

SDK_ROOT = Path(__file__).resolve().parents[1]
EXTENSION_ROOT = SDK_ROOT.parent / "extension" / "dist"
METADATA_PATH = SDK_ROOT.parent / "extension" / "artifacts" / "stagehand-extension.metadata.json"


def unpacked_content_sha256(directory: Path) -> str:
    files: list[tuple[str, Path]] = []
    for entry in directory.rglob("*"):
        relative_path = entry.relative_to(directory).as_posix()
        if entry.is_symlink():
            raise SystemExit(f"Stagehand extension cannot contain symbolic links: {relative_path}")
        if entry.is_dir():
            continue
        if not entry.is_file():
            raise SystemExit(f"Stagehand extension contains an unsupported entry: {relative_path}")
        files.append((relative_path, entry))

    digest = hashlib.sha256()
    for relative_path, entry in sorted(files):
        file_digest = hashlib.sha256(entry.read_bytes()).hexdigest()
        digest.update(f"{relative_path}\n{file_digest}\n".encode())
    return digest.hexdigest()


def assert_public_extension_artifact(metadata: object, unpacked_directory: Path) -> None:
    if not isinstance(metadata, dict) or metadata.get("residentGatewayConfigured") is not False:
        raise SystemExit("Refusing to package a privately configured resident extension in the SDK")
    unpacked_sha256 = metadata.get("unpackedSha256")
    if (
        not isinstance(unpacked_sha256, str)
        or re.fullmatch(r"[0-9a-f]{64}", unpacked_sha256) is None
    ):
        raise SystemExit("Refusing to package a privately configured resident extension in the SDK")
    if unpacked_content_sha256(unpacked_directory) != unpacked_sha256:
        raise SystemExit(
            "Stagehand extension is stale or does not match its metadata; "
            "run the root `just build` command."
        )


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
    if not METADATA_PATH.is_file():
        raise SystemExit(
            "Stagehand extension metadata is missing; run the root `just build` command."
        )
    assert_public_extension_artifact(json.loads(METADATA_PATH.read_text()), EXTENSION_ROOT)

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
            EXTENSION_ROOT,
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
        clean_distribution_directory(output_directory)
        for distribution in (*wheels, *source_distributions):
            shutil.copy2(distribution, output_directory / distribution.name)


if __name__ == "__main__":
    main()
