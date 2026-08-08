from __future__ import annotations

import argparse
import json
from copy import deepcopy
from pathlib import Path
from typing import cast

from datamodel_code_generator import (
    DataModelType,
    Formatter,
    GenerateConfig,
    InputFileType,
    JsonSchemaVersion,
    PythonVersion,
    TargetPydanticVersion,
    generate,
)
from datamodel_code_generator.enums import StrictTypes

SDK_ROOT = Path(__file__).resolve().parents[1]
PROTOCOL_PATH = SDK_ROOT.parent / "protocol" / "stagehand.v4.json"
PROTOCOL_PACKAGE_PATH = SDK_ROOT.parent / "protocol" / "package.json"
MODELS_PATH = SDK_ROOT / "src" / "stagehand" / "_generated" / "models.py"
INPUT_TYPES_PATH = SDK_ROOT / "src" / "stagehand" / "_generated" / "input_types.py"
PROTOCOL_VERSION_PATH = SDK_ROOT / "src" / "stagehand" / "_generated" / "protocol_version.py"
PYDANTIC_CONFIG = GenerateConfig(
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
        "PageScreenshotOptions": "stagehand._validation.PageScreenshotOptionsValidation",
        "TelemetryConfig": "stagehand._validation.TelemetryConfigValidation",
    },
    keep_model_order=True,
    use_double_quotes=True,
    formatters=[Formatter.BUILTIN],
    builtin_format_line_length=88,
)
TYPED_DICT_CONFIG = GenerateConfig(
    # Keep this explicit: the practical preset's unique-item conversion is
    # incompatible with TypedDict output.
    input_file_type=InputFileType.JsonSchema,
    input_filename=PROTOCOL_PATH.name,
    schema_version=JsonSchemaVersion.Draft202012.value,
    output_model_type=DataModelType.TypingTypedDict,
    target_python_version=PythonVersion.PY_311,
    # Client-only input types extend generated protocol options with Python values.
    use_closed_typed_dict=False,
    disable_timestamp=True,
    # Preserve accurate __required_keys__ and __optional_keys__ runtime metadata.
    disable_future_imports=True,
    use_union_operator=True,
    use_standard_collections=True,
    use_standard_primitive_types=True,
    strict_nullable=True,
    skip_root_model=True,
    keep_model_order=True,
    use_double_quotes=True,
    formatters=[Formatter.BUILTIN],
    builtin_format_line_length=88,
)


def _generate_module(protocol: dict[str, object], config: GenerateConfig) -> str:
    module = generate(deepcopy(protocol), config=config)
    if not isinstance(module, str):
        raise TypeError("expected datamodel-code-generator to return one Python module")
    return f"{module.rstrip()}\n"


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

    wire_protocol = deepcopy(protocol)
    use_wire_urls(wire_protocol)
    preserve_json_value_integers(wire_protocol)
    models = _generate_module(wire_protocol, PYDANTIC_CONFIG)
    input_types = _generate_module(protocol, TYPED_DICT_CONFIG)

    protocol_version_module = generate_protocol_version_module()

    if check:
        stale_paths = [
            path
            for path, expected in (
                (MODELS_PATH, models),
                (INPUT_TYPES_PATH, input_types),
                (PROTOCOL_VERSION_PATH, protocol_version_module),
            )
            if not path.exists() or path.read_text() != expected
        ]
        if stale_paths:
            stale = ", ".join(str(path.relative_to(SDK_ROOT)) for path in stale_paths)
            raise SystemExit(f"generated Python files are stale: {stale}")
        return

    MODELS_PATH.parent.mkdir(parents=True, exist_ok=True)
    MODELS_PATH.write_text(models)
    INPUT_TYPES_PATH.write_text(input_types)
    PROTOCOL_VERSION_PATH.write_text(protocol_version_module)


def generate_protocol_version_module() -> str:
    package = cast(dict[str, object], json.loads(PROTOCOL_PACKAGE_PATH.read_text()))
    version = package.get("version")
    if not isinstance(version, str):
        raise TypeError("expected protocol package version to be a string")

    major_text = version.split(".", 1)[0]
    if not major_text.isdecimal() or int(major_text) <= 0:
        raise ValueError(f"invalid Stagehand protocol package version: {version}")

    return (
        '"""Generated from packages/protocol/package.json. Do not edit."""\n\n'
        f"STAGEHAND_PROTOCOL_VERSION = {int(major_text)}\n"
    )


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


def preserve_json_value_integers(protocol: dict[str, object]) -> None:
    """Keep JSON integers as ints instead of routing them through StrictFloat."""
    definitions = protocol.get("$defs")
    if not isinstance(definitions, dict):
        raise TypeError("expected protocol definitions to be a JSON object")

    for name, value in definitions.items():
        if not isinstance(name, str) or not isinstance(value, dict):
            continue
        schema = cast(dict[str, object], value)
        choices = schema.get("anyOf")
        if not isinstance(choices, list):
            continue
        choices = cast(list[object], choices)

        reference = {"$ref": f"#/$defs/{name}"}
        has_recursive_array = any(
            isinstance(choice, dict)
            and choice.get("type") == "array"
            and choice.get("items") == reference
            for choice in choices
        )
        has_recursive_object = any(
            isinstance(choice, dict)
            and choice.get("type") == "object"
            and choice.get("additionalProperties") == reference
            for choice in choices
        )
        if not has_recursive_array or not has_recursive_object:
            continue

        number_index = next(
            (
                index
                for index, choice in enumerate(choices)
                if isinstance(choice, dict) and choice.get("type") == "number"
            ),
            None,
        )
        has_integer = any(
            isinstance(choice, dict) and choice.get("type") == "integer" for choice in choices
        )
        if number_index is not None and not has_integer:
            choices.insert(number_index, {"type": "integer"})


if __name__ == "__main__":
    main()
