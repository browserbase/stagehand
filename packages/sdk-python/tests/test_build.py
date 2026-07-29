from io import BytesIO
from pathlib import Path
from zipfile import ZipFile

import pytest

from scripts.build import (
    clean_distribution_directory,
    validate_extension_archive,
)


def test_clean_distribution_directory_removes_current_and_legacy_artifacts(
    tmp_path: Path,
) -> None:
    stale_artifacts = {
        "stagehand-4.0.0-py3-none-any.whl",
        "stagehand-4.0.0.tar.gz",
        "stagehand_v4-0.1.0-py3-none-any.whl",
        "stagehand_v4-0.1.0.tar.gz",
    }
    for artifact in (*stale_artifacts, "keep.txt"):
        (tmp_path / artifact).write_text("")

    clean_distribution_directory(tmp_path)

    assert {path.name for path in tmp_path.iterdir()} == {"keep.txt"}


def test_validate_extension_archive_requires_a_manifest() -> None:
    archive = BytesIO()
    with ZipFile(archive, mode="w") as extension:
        extension.writestr("service-worker.js", "")

    with pytest.raises(SystemExit, match="does not contain manifest.json"):
        validate_extension_archive(archive.getvalue(), "Test")
