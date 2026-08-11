from importlib.metadata import version

from ._generated.models import ImplementationInfo

STAGEHAND_SDK_VERSION = version("stagehand")

STAGEHAND_SDK_CLIENT_INFO = ImplementationInfo(
    name="stagehand-sdk-python",
    version=STAGEHAND_SDK_VERSION,
)

STAGEHAND_SESSION_METADATA = {
    "stagehand": "true",
    "stagehand_sdk_language": "python",
    "stagehand_sdk_version": STAGEHAND_SDK_VERSION,
}


def stagehand_session_metadata(model_name: str | None = None) -> dict[str, str]:
    metadata = dict(STAGEHAND_SESSION_METADATA)
    if model_name is not None:
        metadata["stagehand_model_name"] = model_name
    return metadata
