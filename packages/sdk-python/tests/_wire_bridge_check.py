from __future__ import annotations

import json
import sys
from typing import Any

from pydantic import BaseModel, ValidationError

from stagehand._generated import models
from stagehand.rpc_client import (
    _JSONRPCErrorResponse,
    _JSONRPCNotification,
    _JSONRPCRequest,
    _JSONRPCSuccessResponse,
)

ENVELOPE_MODELS: dict[str, type[BaseModel]] = {
    "_JSONRPCRequest": _JSONRPCRequest,
    "_JSONRPCNotification": _JSONRPCNotification,
    "_JSONRPCSuccessResponse": _JSONRPCSuccessResponse,
    "_JSONRPCErrorResponse": _JSONRPCErrorResponse,
}


def resolve_model(name: str) -> type[BaseModel]:
    if name in ENVELOPE_MODELS:
        return ENVELOPE_MODELS[name]
    model = getattr(models, name, None)
    if not isinstance(model, type) or not issubclass(model, BaseModel):
        raise KeyError(f"Unknown Python protocol model: {name}")
    return model


def process_line(line: str) -> dict[str, Any]:
    request = json.loads(line)
    model_name = request["model"]
    model = resolve_model(model_name)

    if "rawJson" in request:
        raw_json = request["rawJson"]
    else:
        raw_json = json.dumps(request["payload"], separators=(",", ":"))

    try:
        parsed = model.model_validate_json(raw_json, strict=True)
    except ValidationError as error:
        return {"ok": False, "error": str(error)}

    dumped_json = parsed.model_dump_json(
        by_alias=True,
        exclude_unset=True,
        warnings="none",
    )
    return {
        "ok": True,
        "wire": json.loads(dumped_json),
        "rawJson": dumped_json,
    }


def main() -> None:
    for line in sys.stdin:
        stripped = line.strip()
        if not stripped:
            continue
        result = process_line(stripped)
        sys.stdout.write(json.dumps(result, separators=(",", ":")) + "\n")
    sys.stdout.flush()


if __name__ == "__main__":
    main()
