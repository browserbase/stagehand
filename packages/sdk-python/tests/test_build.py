import hashlib
from pathlib import Path

import pytest

from scripts.build import (
    assert_public_extension_artifact,
    clean_distribution_directory,
    unpacked_content_sha256,
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


def test_unpacked_content_sha256_uses_code_point_path_order(tmp_path: Path) -> None:
    files = {
        "b.txt": b"lower b",
        "a/z.txt": b"nested z",
        "Z.txt": b"upper Z",
    }
    for relative_path, contents in files.items():
        output_path = tmp_path / relative_path
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_bytes(contents)

    expected = hashlib.sha256()
    for relative_path in sorted(files):
        file_digest = hashlib.sha256(files[relative_path]).hexdigest()
        expected.update(f"{relative_path}\n{file_digest}\n".encode())

    assert unpacked_content_sha256(tmp_path) == expected.hexdigest()


def test_assert_public_extension_artifact_rejects_private_metadata(
    tmp_path: Path,
) -> None:
    with pytest.raises(
        SystemExit,
        match="Refusing to package a privately configured resident extension",
    ):
        assert_public_extension_artifact(
            {
                "residentGatewayConfigured": True,
                "unpackedSha256": "a" * 64,
            },
            tmp_path,
        )


def test_assert_public_extension_artifact_rejects_digest_mismatch(
    tmp_path: Path,
) -> None:
    (tmp_path / "manifest.json").write_text("built")

    with pytest.raises(SystemExit, match="Stagehand extension is stale"):
        assert_public_extension_artifact(
            {
                "residentGatewayConfigured": False,
                "unpackedSha256": "a" * 64,
            },
            tmp_path,
        )
