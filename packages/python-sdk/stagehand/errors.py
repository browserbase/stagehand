"""Stagehand error hierarchy.

Mirrors ``packages/ts-sdk/src/errors.ts`` so client code can catch the same
structured exceptions whether it uses the TypeScript or Python thin client.
"""

from __future__ import annotations

from typing import List, Type


class StagehandError(RuntimeError):
    """Base exception for all Stagehand SDK errors."""

    def __init__(self, message: str | None = None) -> None:
        super().__init__(message)
        self.name = self.__class__.__name__


class AgentScreenshotProviderError(StagehandError):
    ...


class BrowserbaseSessionNotFoundError(StagehandError):
    ...


class CaptchaTimeoutError(StagehandError):
    ...


class ConnectionTimeoutError(StagehandError):
    ...


class ContentFrameNotFoundError(StagehandError):
    ...


class CreateChatCompletionResponseError(StagehandError):
    ...


class CuaModelRequiredError(StagehandError):
    ...


class ElementNotVisibleError(StagehandError):
    ...


class ExperimentalApiConflictError(StagehandError):
    ...


class ExperimentalNotConfiguredError(StagehandError):
    ...


class HandlerNotInitializedError(StagehandError):
    ...


class InvalidAISDKModelFormatError(StagehandError):
    ...


class LLMResponseError(StagehandError):
    ...


class MCPConnectionError(StagehandError):
    ...


class MissingEnvironmentVariableError(StagehandError):
    ...


class MissingLLMConfigurationError(StagehandError):
    ...


class PageNotFoundError(StagehandError):
    ...


class ResponseBodyError(StagehandError):
    ...


class ResponseParseError(StagehandError):
    ...


class StagehandAPIError(StagehandError):
    ...


class StagehandAPIUnauthorizedError(StagehandError):
    ...


class StagehandClickError(StagehandError):
    ...


class StagehandDefaultError(StagehandError):
    ...


class StagehandDomProcessError(StagehandError):
    ...


class StagehandElementNotFoundError(StagehandError):
    ...


class StagehandEnvironmentError(StagehandError):
    ...


class StagehandEvalError(StagehandError):
    ...


class StagehandHttpError(StagehandError):
    ...


class StagehandIframeError(StagehandError):
    ...


class StagehandInitError(StagehandError):
    ...


class StagehandInvalidArgumentError(StagehandError):
    ...


class StagehandMissingArgumentError(StagehandError):
    ...


class StagehandNotInitializedError(StagehandError):
    ...


class StagehandResponseBodyError(StagehandError):
    ...


class StagehandResponseParseError(StagehandError):
    ...


class StagehandServerError(StagehandError):
    ...


class StagehandShadowRootMissingError(StagehandError):
    ...


class StagehandShadowSegmentEmptyError(StagehandError):
    ...


class StagehandShadowSegmentNotFoundError(StagehandError):
    ...


class TimeoutError(StagehandError):
    ...


class UnsupportedAISDKModelProviderError(StagehandError):
    ...


class UnsupportedModelError(StagehandError):
    ...


class UnsupportedModelProviderError(StagehandError):
    ...


class XPathResolutionError(StagehandError):
    ...


class ZodSchemaValidationError(StagehandError):
    ...


# Populate __all__ automatically to ensure new subclasses are exported.
__all__ = [
    cls.__name__
    for cls in globals().values()
    if isinstance(cls, type) and issubclass(cls, StagehandError)
]
