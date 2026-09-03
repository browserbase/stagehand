from importlib.metadata import PackageNotFoundError, version

from ._generated.models import ImplementationInfo


def _resolve_sdk_version() -> str:
    try:
        return version("stagehand")
    except PackageNotFoundError:
        return "0.0.0-dev"


STAGEHAND_SDK_VERSION = _resolve_sdk_version()

STAGEHAND_SDK_CLIENT_INFO = ImplementationInfo(
    name="stagehand-sdk-python",
    version=STAGEHAND_SDK_VERSION,
)

STAGEHAND_SESSION_METADATA = {
    "stagehand": "true",
    "stagehand_sdk_language": "python",
    "stagehand_sdk_version": STAGEHAND_SDK_VERSION,
}
