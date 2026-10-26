import pytest
from pydantic import ValidationError

from stagehand._generated.models import (
    PageEventNotification,
    PageToolsAddedNotification,
    PageToolsRemovedNotification,
)


@pytest.mark.parametrize("event", ["toolsadded", "toolsremoved"])
def test_page_event_notification_round_trip(event: str) -> None:
    tool: dict[str, object] = {"name": "search", "frame_id": "child-frame"}
    if event == "toolsadded":
        tool.update({
            "description": "Search",
            "input_schema": {"properties": {"queryText": {"type": "string"}}},
        })
    payload = {
        "subscription_id": "subscription-1",
        "page_id": "page-1",
        "session_id": "session-1",
        "target_id": "target-1",
        "event": event,
        "tools": [tool],
    }
    notification = PageEventNotification.model_validate(payload)
    expected_type = (
        PageToolsAddedNotification if event == "toolsadded" else PageToolsRemovedNotification
    )
    assert isinstance(notification.root, expected_type)
    assert notification.root.tools[0].frame_id == "child-frame"
    assert notification.model_dump(mode="json", exclude_unset=True) == payload

    payload["event"] = "toolsremoved" if event == "toolsadded" else "toolsadded"
    with pytest.raises(ValidationError):
        PageEventNotification.model_validate(payload)
