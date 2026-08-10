import base64
import re
from pathlib import Path
from typing import Any

from mcp.types import CallToolResult, ImageContent, TextContent, Tool

from agent import ImageSavingToolAdapter, facade_session


def test_facade_tool_contract() -> None:
    with facade_session() as tools:
        assert sorted(tool.name for tool in tools) == ["run", "screenshot", "snapshot"]
        run_tool = next(tool for tool in tools if tool.name == "run")
        assert 'never "kind"' in run_tool.description


def test_image_saving_tool_adapter_preserves_screenshot() -> None:
    payload = b"\x89PNG\r\n\x1a\nexample"
    encoded_payload = base64.b64encode(payload).decode()

    def fake_func(arguments: dict[str, Any] | None) -> CallToolResult:
        assert arguments == {}
        return CallToolResult(
            content=[
                TextContent(type="text", text="Screenshot captured."),
                ImageContent(type="image", data=encoded_payload, mimeType="image/png"),
            ]
        )

    mcp_tool = Tool(
        name="screenshot",
        description="d",
        inputSchema={"type": "object", "properties": {}},
    )
    tool = ImageSavingToolAdapter().adapt(fake_func, mcp_tool)
    result = tool.run()
    match = re.search(r"Screenshot saved to (.+?\.png)\.", result)

    assert match is not None
    screenshot_path = Path(match.group(1))
    try:
        assert screenshot_path.is_file()
        assert screenshot_path.read_bytes() == payload
        assert encoded_payload not in result
    finally:
        screenshot_path.unlink(missing_ok=True)
