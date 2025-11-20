"""Stagehand SDK constants and schema helpers.

This mirrors the structure of ``packages/ts-sdk/src/constants.ts`` but keeps the
implementations intentionally lightweight—enough for downstream code to develop
against while the real runtime logic is built out.
"""

from __future__ import annotations

import re
from typing import Dict, List, Mapping, Sequence, Tuple

from .errors import ZodSchemaValidationError
from .types import (
    AgentModelConfig,
    AgentProviderType,
    JsonSchema,
    JsonSchemaDocument,
    LogLevel,
    Logger,
    ModelProvider,
    StagehandZodObject,
    StagehandZodSchema,
)

__all__ = [
    "AnnotatedScreenshotText",
    "LOG_LEVEL_NAMES",
    "AVAILABLE_CUA_MODELS",
    "modelToAgentProviderMap",
    "providerEnvVarMap",
    "defaultExtractSchema",
    "pageTextSchema",
    "getZodType",
    "transformSchema",
    "injectUrls",
    "trimTrailingTextNode",
    "validateZodSchema",
    "toGeminiSchema",
    "toJsonSchema",
    "jsonSchemaToZod",
    "loadApiKeyFromEnv",
    "isRunningInBun",
    "isZod3Schema",
    "isZod4Schema",
]


class SchemaStub(StagehandZodObject):
    """Tiny schema placeholder used until the real runtime ships."""

    kind: str = "stagehand-sdk-schema"
    shape: Dict[str, object]

    def __init__(self, shape: Mapping[str, object]) -> None:
        super().__init__(shape=dict(shape))


def _create_schema_stub(shape: Mapping[str, object]) -> SchemaStub:
    return SchemaStub(shape)


AnnotatedScreenshotText = (
    "This is a screenshot of the current page state with the elements annotated "
    "on it. Each element id is annotated with a number to the top left of it. "
    "Duplicate annotations at the same location are under each other vertically."
)

LOG_LEVEL_NAMES: Mapping[LogLevel, str] = {
    0: "error",
    1: "info",
    2: "debug",
}

AVAILABLE_CUA_MODELS: Mapping[str, AgentModelConfig] = {}

modelToAgentProviderMap: Mapping[str, AgentProviderType] = {}

providerEnvVarMap: Mapping[ModelProvider | str, str | Sequence[str]] = {}

defaultExtractSchema = _create_schema_stub({"extraction": "string"})

pageTextSchema = _create_schema_stub({"pageText": "string"})


def getZodType(schema: StagehandZodSchema) -> str:
    """Return the best-effort Zod typename for debugging/logging."""

    schema_dict = schema.model_dump(exclude_none=True) if hasattr(schema, "model_dump") else {}
    definition = schema_dict.get("_def", {})
    return str(definition.get("typeName", "unknown"))


def transformSchema(
    schema: StagehandZodSchema,
    _currentPath: Sequence[str | int] | None = None,
) -> Tuple[StagehandZodSchema, List[List[str | int]]]:
    """Placeholder transformer that mirrors the TS stub behavior."""

    _ = _currentPath  # intentionally unused; parity with TS stub
    return schema, []


def injectUrls(
    _obj: object,
    _path: Sequence[str | int],
    _idToUrlMapping: Mapping[str, str],
) -> None:
    """Stub hook that would populate URL references in schemas."""

    return None


def trimTrailingTextNode(selector: str | None) -> str | None:
    if not selector:
        return selector
    return re.sub(r"/text\(\)\[\d+\]$", "", selector)


def validateZodSchema(schema: StagehandZodSchema | None) -> StagehandZodSchema:
    if schema is None:
        raise ZodSchemaValidationError("A schema instance is required")
    return schema


def toGeminiSchema(schema: StagehandZodSchema) -> JsonSchemaDocument:
    return {"schema": schema.model_dump() if hasattr(schema, "model_dump") else schema}


def toJsonSchema(schema: StagehandZodObject) -> JsonSchemaDocument:
    return {"schema": schema.model_dump() if hasattr(schema, "model_dump") else schema}


def jsonSchemaToZod(_schema: JsonSchema) -> StagehandZodSchema:
    return _create_schema_stub({})


def loadApiKeyFromEnv(_provider: str | None, _logger: Logger | None = None) -> str | None:
    return None


def isRunningInBun() -> bool:
    return False


def isZod3Schema(_schema: object) -> bool:
    return False


def isZod4Schema(_schema: object) -> bool:
    return False
