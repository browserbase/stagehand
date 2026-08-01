from __future__ import annotations

import io
import os
import zipfile
from pathlib import Path


def extension_directory() -> Path:
    extension_dir = Path(__file__).with_name("_extension")
    if not (extension_dir / "manifest.json").is_file():
        extension_dir = Path(__file__).resolve().parents[3] / "server" / "dist"
    return extension_dir


def build_extension_archive() -> bytes:
    extension_dir = extension_directory()
    if not (extension_dir / "manifest.json").is_file():
        raise FileNotFoundError(
            f"Stagehand extension manifest.json was not found in {extension_dir}"
        )

    archive = io.BytesIO()
    with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as output:
        for root, directories, files in os.walk(extension_dir):
            directories.sort()
            for filename in sorted(files):
                path = Path(root) / filename
                output.write(path, path.relative_to(extension_dir).as_posix())
    return archive.getvalue()
