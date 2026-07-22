from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import cast

from datamodel_code_generator import (
    DataModelType,
    Formatter,
    GenerateConfig,
    InputFileType,
    JsonSchemaVersion,
    TargetPydanticVersion,
    generate,
)
from datamodel_code_generator.enums import StrictTypes

SDK_ROOT = Path(__file__).resolve().parents[1]
PROTOCOL_PATH = SDK_ROOT.parent / "protocol" / "stagehand.v4.json"
MODELS_PATH = SDK_ROOT / "src" / "stagehand" / "_generated" / "models.py"
DATAMODEL_CONFIG = GenerateConfig(
    preset="practical-py311-20260619",
    input_file_type=InputFileType.JsonSchema,
    input_filename=PROTOCOL_PATH.name,
    schema_version=JsonSchemaVersion.Draft202012.value,
    output_model_type=DataModelType.PydanticV2BaseModel,
    target_pydantic_version=TargetPydanticVersion.V2_12,
    base_class="stagehand._validation.WireModel",
    use_union_operator=False,
    collapse_root_models=False,
    collapse_reuse_models=False,
    reuse_model=False,
    skip_root_model=True,
    strict_types=[
        StrictTypes.str,
        StrictTypes.bytes,
        StrictTypes.int,
        StrictTypes.float,
        StrictTypes.bool,
    ],
    type_mappings=["string+byte=string", "string+uuid=string"],
    base_class_map={
        "Locator": "stagehand._validation.LocatorValidation",
        "PageScreenshotOptions": "stagehand._validation.PageScreenshotOptionsValidation",
        "TelemetryConfig": "stagehand._validation.TelemetryConfigValidation",
    },
    keep_model_order=True,
    use_double_quotes=True,
    formatters=[Formatter.BUILTIN],
    builtin_format_line_length=88,
)


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate Python wire models from the protocol")
    parser.add_argument("--check", action="store_true", help="fail when generated models differ")
    check = parser.parse_args().check

    protocol = cast(dict[str, object], json.loads(PROTOCOL_PATH.read_text()))
    # Keep local references local instead of resolving them against the published schema URL.
    protocol.pop("$id")

    properties = protocol.get("properties")
    if not isinstance(properties, dict):
        raise TypeError("expected protocol properties to be a JSON object")
    properties = cast(dict[str, object], properties)
    # The transport envelopes are not public Python data models.
    properties.pop("jsonrpc")

    required = protocol.get("required")
    if not isinstance(required, list):
        raise TypeError("expected protocol required fields to be an array")
    required = cast(list[object], required)
    required.remove("jsonrpc")

    definitions = protocol.get("$defs")
    if not isinstance(definitions, dict):
        raise TypeError("expected protocol definitions to be a JSON object")
    definitions = cast(dict[str, object], definitions)
    for envelope in (
        "StagehandRpcRequest",
        "StagehandRpcNotification",
        "JSONRPCSuccessResponse",
        "JSONRPCErrorResponse",
    ):
        definitions.pop(envelope)

    use_wire_urls(protocol)
    models = generate(protocol, config=DATAMODEL_CONFIG)
    if not isinstance(models, str):
        raise TypeError("expected datamodel-code-generator to return one Python module")
    models = f"{models.rstrip()}\n"

    if check:
        if not MODELS_PATH.exists() or MODELS_PATH.read_text() != models:
            raise SystemExit(
                f"generated Python models are stale: {MODELS_PATH.relative_to(SDK_ROOT)}"
            )
        return

    MODELS_PATH.parent.mkdir(parents=True, exist_ok=True)
    MODELS_PATH.write_text(models)


def use_wire_urls(value: object) -> None:
    if isinstance(value, list):
        for entry in value:
            use_wire_urls(entry)
        return
    if not isinstance(value, dict):
        return
    mapping = cast(dict[str, object], value)
    # Preserve Python's `str` API while retaining Pydantic URL validation.
    if mapping.get("type") == "string" and mapping.get("format") == "uri":
        mapping["customTypePath"] = "stagehand._validation.WireUrl"
    for entry in mapping.values():
        use_wire_urls(entry)


if __name__ == "__main__":
    main()
