import json
from pathlib import Path

import pytest

from stagehand import extension_assets

FINGERPRINT = "a" * 64


def use_extension_directory(
    monkeypatch: pytest.MonkeyPatch, directory: Path, build_info: Path, contents: str | None
) -> None:
    directory.mkdir(parents=True)
    if contents is not None:
        build_info.parent.mkdir(parents=True, exist_ok=True)
        build_info.write_text(contents)
    monkeypatch.setattr(extension_assets, "extension_directory", lambda: directory)


def test_reads_the_build_file_beside_the_packaged_extension(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    use_extension_directory(
        monkeypatch,
        tmp_path / "_extension",
        tmp_path / "_extension_build.json",
        json.dumps({"fingerprint": FINGERPRINT}),
    )
    assert extension_assets._extension_fingerprint() == FINGERPRINT


def test_reads_the_build_file_of_a_checkout_extension(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    use_extension_directory(
        monkeypatch,
        tmp_path / "dist",
        tmp_path / "artifacts" / "extension-build.json",
        json.dumps({"fingerprint": FINGERPRINT}),
    )
    assert extension_assets._extension_fingerprint() == FINGERPRINT


@pytest.mark.parametrize("contents", ["", "null", "[]", '{"fingerprint": 1}'])
def test_rejects_a_malformed_build_file(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, contents: str
) -> None:
    use_extension_directory(
        monkeypatch, tmp_path / "_extension", tmp_path / "_extension_build.json", contents
    )
    with pytest.raises(ValueError, match="does not contain an extension fingerprint"):
        extension_assets._extension_fingerprint()


def test_rejects_a_missing_build_file(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    use_extension_directory(
        monkeypatch, tmp_path / "_extension", tmp_path / "_extension_build.json", None
    )
    with pytest.raises(OSError, match="could not be read"):
        extension_assets._extension_fingerprint()
