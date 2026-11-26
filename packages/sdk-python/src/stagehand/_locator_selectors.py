import re
from typing import cast

from ._generated.input_types import (
    AriaRole,
    LocatorFrameStep,
    LocatorQuerySelector,
    LocatorQueryStep,
    LocatorStep,
)
from ._generated.models import RoleSelectorQuery


def text_query_step(text: str, exact: bool = False) -> LocatorQueryStep:
    if not isinstance(text, str):
        raise TypeError("Text queries require a string matcher")
    if not isinstance(exact, bool):
        raise TypeError("exact must be a boolean")
    return {"type": "query", "selector": {"kind": "textMatch", "value": text, "exact": exact}}


def role_query_step(role: AriaRole, **options: object) -> LocatorQueryStep:
    selector = RoleSelectorQuery.model_validate({
        "kind": "role",
        "value": role,
        **{key: value for key, value in options.items() if value is not None or key == "exact"},
    })
    return cast(
        LocatorQueryStep,
        {"type": "query", "selector": selector.model_dump(mode="json", exclude_unset=True)},
    )


def _query(raw: str) -> LocatorQuerySelector:
    value = raw.strip()
    if value.lower().startswith("text="):
        value = value[5:].strip()
        if value.startswith(('"', "'")) and value.endswith(value[0]):
            value = value[1:-1]
        return {"kind": "text", "value": value}
    if value.lower().startswith("xpath=") or value.startswith(("/", "(")):
        return {"kind": "xpath", "value": re.sub(r"^xpath=", "", value, flags=re.I)}
    value = re.sub(r"^css=", "", value, flags=re.I)
    if ">>" in value:
        value = " ".join(part.strip() for part in value.split(">>") if part.strip())
    return {"kind": "css", "value": value}


def _frame_selectors(raw: str) -> list[str]:
    selector = raw.strip()
    parts = [part.strip() for part in selector.split(">>") if part.strip()]
    if len(parts) > 1:
        return parts
    if (
        selector.startswith("xpath=")
        and not selector[6:].strip().startswith("/")
        and ">>" not in selector
    ):
        return [selector]
    if not selector.startswith(("xpath=", "/")):
        return [selector]

    path = selector.removeprefix("xpath=").strip()
    if not path.startswith("/"):
        path = "/" + path
    steps = [(match[1], match[2].strip()) for match in re.finditer(r"(//?)([^/]*)", path)]
    steps = [(axis, value) for axis, value in steps if value]
    frames: list[str] = []
    buffer = ""
    for index, (axis, value) in enumerate(steps):
        buffer += axis + value
        if re.fullmatch(r"i?frame(?:\[\d+\])?", value, flags=re.I) and index < len(steps) - 1:
            frames.append("xpath=" + buffer)
            buffer = ""
    return [*frames, "xpath=" + (buffer or "/")]


def locator_steps(selector: str) -> list[LocatorStep]:
    first, *rest = _frame_selectors(selector)
    query: LocatorQueryStep = {"type": "query", "selector": _query(first)}
    frames: list[LocatorFrameStep] = [
        {"type": "frame", "selector": _query(value)} for value in rest
    ]
    return [query, *frames]
