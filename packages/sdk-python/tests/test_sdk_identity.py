from importlib.metadata import PackageNotFoundError

import pytest

from stagehand import _sdk_identity


def test_sdk_version_falls_back_without_distribution_metadata(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def missing_version(_distribution_name: str) -> str:
        raise PackageNotFoundError

    monkeypatch.setattr(_sdk_identity, "version", missing_version)

    assert _sdk_identity._resolve_sdk_version() == "0.0.0-dev"
