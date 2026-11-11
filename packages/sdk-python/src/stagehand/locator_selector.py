"""Normalize SDK locator inputs into engine queries and explicit frame hops."""

import re

from ._generated.models import LocatorChain, LocatorSelector
from .client_types import LocatorInput


def normalize_locator_selector(value: LocatorInput) -> LocatorChain:
    selector = LocatorSelector.model_validate(
        {"type": "legacy", "value": value} if isinstance(value, str) else value
    ).root
    if selector.type != "legacy":
        return LocatorChain.model_validate({
            "steps": [{"type": "query", "selector": selector.model_dump()}],
        })
    raw = selector.value.strip()
    hops = [part.strip() for part in raw.split(">>") if part.strip()]
    if len(hops) > 1:
        return _from_hops([_parse_legacy_query(part) for part in hops])

    # Match the historical deep-XPath dispatch, including its case sensitivity.
    if raw.startswith(("xpath=", "/")):
        path = raw[6:].strip() if raw.startswith("xpath=") else raw
        if not path.startswith("/"):
            path = "/" + path
        tokens = [
            (axis, part.strip()) for axis, part in re.findall(r"(//?)([^/]*)", path) if part.strip()
        ]
        queries: list[dict[str, str]] = []
        buffer = ""
        for index, (axis, part) in enumerate(tokens):
            buffer += axis + part
            name = re.sub(r"\[\d+\]\s*$", "", part).lower()
            if re.fullmatch(r"i?frame(?:\[\d+\])?", name) and index < len(tokens) - 1:
                queries.append({"type": "xpath", "value": buffer})
                buffer = ""
        queries.append({"type": "xpath", "value": buffer or "/"})
        return _from_hops(queries)
    return _from_hops([_parse_legacy_query(raw)])


def _from_hops(selectors: list[dict[str, str]]) -> LocatorChain:
    return LocatorChain.model_validate({
        "steps": [
            {
                "type": "query" if index == 0 else "frame",
                "selector": selector,
                **({"nth": 0} if index < len(selectors) - 1 else {}),
            }
            for index, selector in enumerate(selectors)
        ],
    })


def _parse_legacy_query(raw: str) -> dict[str, str]:
    trimmed = raw.strip()
    if re.match(r"^text=", trimmed, re.I):
        value = trimmed[5:].strip()
        if value.startswith(('"', "'")) and value.endswith(value[0]):
            value = value[1:-1]
        return {"type": "text", "value": value} if value else {"type": "css", "value": ":not(*)"}
    if re.match(r"^xpath=", trimmed, re.I) or trimmed.startswith(("/", "(")):
        return {"type": "xpath", "value": re.sub(r"^xpath=", "", trimmed, flags=re.I) or "/"}
    value = re.sub(r"^css=", "", trimmed, flags=re.I)
    value = " ".join(part.strip() for part in value.split(">>") if part.strip())
    return {"type": "css", "value": value or ":not(*)"}


def with_locator_index(chain: LocatorChain, index: int) -> LocatorChain:
    values = chain.model_dump(exclude_unset=True)
    values["steps"][-1]["nth"] = index
    return LocatorChain.model_validate(values)
