from __future__ import annotations

import shutil
import subprocess
import tarfile
import tempfile
import zipfile
from io import BytesIO
from pathlib import Path

SDK_ROOT = Path(__file__).resolve().parents[1]
SERVER_EXTENSION_ROOT = SDK_ROOT.parent / "server" / "dist"
SERVER_EXTENSION_ARCHIVE = SDK_ROOT.parent / "server" / "artifacts" / "stagehand-extension.zip"
PACKAGE_EXTENSION_ARCHIVE = "stagehand/_extension/stagehand-extension.zip"


def validate_extension_archive(archive: bytes, source: str) -> None:
    try:
        with zipfile.ZipFile(BytesIO(archive)) as extension:
            if "manifest.json" not in extension.namelist():
                raise SystemExit(f"{source} extension ZIP does not contain manifest.json")
    except zipfile.BadZipFile as error:
        raise SystemExit(f"{source} contains an invalid extension ZIP") from error


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
    if not (SERVER_EXTENSION_ROOT / "manifest.json").is_file():
        raise SystemExit("Stagehand extension is not built; run the root `just build` command.")
    if not SERVER_EXTENSION_ARCHIVE.is_file():
        raise SystemExit("Stagehand extension ZIP is not built; run the root `just build` command.")
    validate_extension_archive(
        SERVER_EXTENSION_ARCHIVE.read_bytes(),
        "Server build",
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
            ),
        )
        staged_extension_root = staged_sdk / "src" / "stagehand" / "_extension"
        shutil.copytree(
            SERVER_EXTENSION_ROOT,
            staged_extension_root,
        )
        shutil.copy2(
            SERVER_EXTENSION_ARCHIVE,
            staged_extension_root / SERVER_EXTENSION_ARCHIVE.name,
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
            if PACKAGE_EXTENSION_ARCHIVE not in wheel.namelist():
                raise SystemExit("Built wheel does not contain the Stagehand extension ZIP")
            validate_extension_archive(
                wheel.read(PACKAGE_EXTENSION_ARCHIVE),
                "Built wheel",
            )

        with tarfile.open(source_distributions[0], mode="r:gz") as source_distribution:
            members = source_distribution.getmembers()
            if not any(
                member.name.endswith("/src/stagehand/_extension/manifest.json")
                for member in members
            ):
                raise SystemExit(
                    "Built source distribution does not contain the Stagehand extension"
                )
            archive_member = next(
                (
                    member
                    for member in members
                    if member.name.endswith(f"/src/{PACKAGE_EXTENSION_ARCHIVE}")
                ),
                None,
            )
            if archive_member is None:
                raise SystemExit(
                    "Built source distribution does not contain the Stagehand extension ZIP"
                )
            archive_file = source_distribution.extractfile(archive_member)
            if archive_file is None:
                raise SystemExit(
                    "Could not read the Stagehand extension ZIP from the source distribution"
                )
            validate_extension_archive(
                archive_file.read(),
                "Built source distribution",
            )

        output_directory = SDK_ROOT / "dist"
        output_directory.mkdir(exist_ok=True)
        clean_distribution_directory(output_directory)
        for distribution in (*wheels, *source_distributions):
            shutil.copy2(distribution, output_directory / distribution.name)


if __name__ == "__main__":
    main()
