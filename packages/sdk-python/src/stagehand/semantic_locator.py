from __future__ import annotations

import re

from ._generated.input_types import AriaRole as AriaRoleName
from ._generated.models import (
    AriaRole,
    GetByRoleOptions,
    LocatorDescriptor,
    QueryStep,
    SemanticLocatorQuery,
    TextPattern,
)

_PREFIX = "internal:locator="


def _text_pattern(value: str | re.Pattern[str]) -> TextPattern:
    if isinstance(value, str):
        return TextPattern(root=value)
    if value.flags & ~(re.IGNORECASE | re.MULTILINE | re.DOTALL | re.UNICODE):
        raise ValueError("Locator patterns support only IGNORECASE, MULTILINE, and DOTALL flags")
    flags = "".join(
        flag
        for enabled, flag in (
            (value.flags & re.IGNORECASE, "i"),
            (value.flags & re.MULTILINE, "m"),
            (value.flags & re.DOTALL, "s"),
        )
        if enabled
    )
    return TextPattern.model_validate({"source": value.pattern, "flags": flags})


def _decode(selector: str) -> list[QueryStep]:
    if selector.startswith(_PREFIX):
        steps = SemanticLocatorQuery.model_validate_json(selector[len(_PREFIX) :]).root
        if steps[0].root.kind == "nth":
            raise ValueError(
                "A semantic locator query must start with a selector, role, or text step"
            )
        return steps
    return [selector_step(selector)]


def encode_step(step: QueryStep, parent: LocatorDescriptor | None = None) -> str:
    steps = _decode(parent.selector) if parent is not None else []
    if parent is not None and parent.nth is not None:
        steps.append(QueryStep.model_validate({"kind": "nth", "index": parent.nth}))
    return _PREFIX + SemanticLocatorQuery(root=[*steps, step]).model_dump_json(exclude_none=True)


def selector_step(selector: str) -> QueryStep:
    if selector.strip().startswith(_PREFIX):
        raise ValueError("Selector steps cannot contain another semantic locator query")
    return QueryStep.model_validate({"kind": "selector", "selector": selector})


def role_step(
    role: AriaRole | AriaRoleName,
    *,
    name: str | re.Pattern[str] | None = None,
    description: str | re.Pattern[str] | None = None,
    exact: bool | None = None,
    include_hidden: bool | None = None,
    disabled: bool | None = None,
    expanded: bool | None = None,
    selected: bool | None = None,
    checked: bool | None = None,
    pressed: bool | None = None,
    level: int | None = None,
) -> QueryStep:
    options = GetByRoleOptions(
        name=_text_pattern(name) if name is not None else None,
        description=_text_pattern(description) if description is not None else None,
        exact=exact,
        include_hidden=include_hidden,
        disabled=disabled,
        expanded=expanded,
        selected=selected,
        checked=checked,
        pressed=pressed,
        level=level,
    )
    return QueryStep.model_validate({"kind": "role", "role": role, "options": options})


def text_step(text: str | re.Pattern[str], *, exact: bool | None = None) -> QueryStep:
    return QueryStep.model_validate({"kind": "text", "text": _text_pattern(text), "exact": exact})
