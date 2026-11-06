import io
import json
import zipfile
from pathlib import Path

from stagehand import get_extension_archive


def test_public_extension_archive_can_be_loaded_unpacked(tmp_path: Path) -> None:
    data = get_extension_archive()
    assert isinstance(data, bytes)

    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        assert archive.testzip() is None
        archive.extractall(tmp_path)

    manifest = json.loads((tmp_path / "manifest.json").read_text())
    assert manifest["manifest_version"] == 3
    assert manifest["name"] == "Stagehand Runtime"
    assert manifest["version"]
    worker = tmp_path / manifest["background"]["service_worker"]
    assert worker.is_file()
    assert worker.stat().st_size > 0


def test_public_extension_archive_is_repeatable() -> None:
    assert get_extension_archive() == get_extension_archive()
