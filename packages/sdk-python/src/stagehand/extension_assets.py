from __future__ import annotations

from pathlib import Path


def extension_directory() -> Path:
    extension_dir = Path(__file__).with_name("_extension")
    if not (extension_dir / "manifest.json").is_file():
        extension_dir = Path(__file__).resolve().parents[3] / "extension" / "dist"
    return extension_dir
