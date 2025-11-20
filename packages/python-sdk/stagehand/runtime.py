"""Runtime stubs for the Stagehand Python SDK.

This mirrors ``packages/ts-sdk/src/runtime.ts`` from the TypeScript thin client so
that downstream Python callers can rely on a consistent API surface while the
real implementation is still under development.
"""

from __future__ import annotations

from collections.abc import AsyncIterator, Mapping
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional, Sequence, Union

from pydantic import BaseModel, ConfigDict, Field

from .client import StagehandSDKNotImplementedError
from .types import (
    ActOptions,
    ActResult,
    Action,
    AgentAction,
    AgentClient,
    AgentConfig,
    AgentExecuteOptions,
    AgentResult,
    AgentReplayStep,
    AnyPage,
    ClientOptions,
    ConnectToMCPServerOptions,
    CreateChatCompletionOptions,
    ExtractOptions,
    HistoryEntry,
    JsonSchema,
    LLMResponse,
    Logger,
    LogLine,
    MCPClient,
    ObserveOptions,
    StagehandMetrics,
    StdioServerConfig,
    V3FunctionName,
    V3Options,
)


class ConsoleMessage(BaseModel):
    """Lightweight container for console output emitted by the browser."""

    type: str
    message: str
    args: List[Any] = Field(default_factory=list)
    location: Dict[str, Any] = Field(default_factory=dict)

    model_config = ConfigDict(arbitrary_types_allowed=True)

    def text(self) -> str:
        """Return the raw console message text."""

        return self.message

    def argumentValues(self) -> List[Any]:
        """Return the captured argument payloads."""

        return list(self.args)


class Response:
    """Placeholder for a Playwright/Puppeteer-style response object."""

    def url(self) -> str:
        raise StagehandSDKNotImplementedError("Response.url")

    def status(self) -> int:
        raise StagehandSDKNotImplementedError("Response.status")

    def statusText(self) -> str:
        raise StagehandSDKNotImplementedError("Response.statusText")

    def headers(self) -> Dict[str, str]:
        raise StagehandSDKNotImplementedError("Response.headers")

    def headersArray(self) -> List[Dict[str, str]]:
        raise StagehandSDKNotImplementedError("Response.headersArray")

    async def allHeaders(self) -> Dict[str, str]:
        raise StagehandSDKNotImplementedError("Response.allHeaders")

    def headerValue(self, _name: str) -> Optional[str]:
        raise StagehandSDKNotImplementedError("Response.headerValue")

    def headerValues(self, _name: str) -> List[str]:
        raise StagehandSDKNotImplementedError("Response.headerValues")

    def finished(self) -> bool:
        return False

    def markFinished(self) -> None:
        return None

    def applyExtraInfo(self, _info: Any) -> None:
        return None

    def fromServiceWorker(self) -> bool:
        return False

    def frame(self) -> Any:
        return None

    def ok(self) -> bool:
        return False

    def securityDetails(self) -> Any:
        return None

    def serverAddr(self) -> Any:
        return None

    async def body(self) -> bytes:
        raise StagehandSDKNotImplementedError("Response.body")

    async def text(self) -> str:
        raise StagehandSDKNotImplementedError("Response.text")

    async def json(self) -> Any:
        raise StagehandSDKNotImplementedError("Response.json")


class _RejectedAsyncIterator(AsyncIterator[Any]):
    """Async iterator that fails immediately to mimic the TS stub."""

    def __init__(self, method: str) -> None:
        self.method = method

    def __aiter__(self) -> "_RejectedAsyncIterator":
        return self

    async def __anext__(self) -> Any:
        raise StagehandSDKNotImplementedError(self.method)


class LLMClient:
    """Placeholder LLM client with the same surface area as the TS version."""

    type: str = "sdk"
    modelName: str
    hasVision: bool = False
    clientOptions: ClientOptions
    userProvidedInstructions: Optional[str]

    def __init__(self, modelName: str, userProvidedInstructions: Optional[str] = None) -> None:
        self.modelName = modelName
        self.userProvidedInstructions = userProvidedInstructions
        self.clientOptions = {}

    async def generateText(self, *args: Any, **kwargs: Any) -> Any:
        raise StagehandSDKNotImplementedError("LLMClient.generateText")

    async def generateObject(self, *args: Any, **kwargs: Any) -> Any:
        raise StagehandSDKNotImplementedError("LLMClient.generateObject")

    def streamText(self, *args: Any, **kwargs: Any) -> AsyncIterator[Any]:
        return _RejectedAsyncIterator("LLMClient.streamText")

    def streamObject(self, *args: Any, **kwargs: Any) -> AsyncIterator[Any]:
        return _RejectedAsyncIterator("LLMClient.streamObject")

    async def generateImage(self, *args: Any, **kwargs: Any) -> Any:
        raise StagehandSDKNotImplementedError("LLMClient.generateImage")

    async def embed(self, *args: Any, **kwargs: Any) -> Any:
        raise StagehandSDKNotImplementedError("LLMClient.embed")

    async def embedMany(self, *args: Any, **kwargs: Any) -> Any:
        raise StagehandSDKNotImplementedError("LLMClient.embedMany")

    async def transcribe(self, *args: Any, **kwargs: Any) -> Any:
        raise StagehandSDKNotImplementedError("LLMClient.transcribe")

    async def generateSpeech(self, *args: Any, **kwargs: Any) -> Any:
        raise StagehandSDKNotImplementedError("LLMClient.generateSpeech")


class AISdkClient(LLMClient):
    """Minimal mirror of the TypeScript ``AISdkClient`` class."""

    def __init__(self, *, model: Any) -> None:
        if isinstance(model, Mapping):
            name = str(model.get("name", "unknown"))
        else:
            maybe_name = getattr(model, "name", None)
            name = str(maybe_name) if maybe_name is not None else "unknown"
        super().__init__(name)

    async def createChatCompletion(self, _options: CreateChatCompletionOptions) -> LLMResponse:
        raise StagehandSDKNotImplementedError("AISdkClient.createChatCompletion")


class AgentProvider:
    def __init__(self, logger: Optional[Logger] = None) -> None:
        self.logger = logger

    def getClient(
        self,
        _modelName: str,
        _clientOptions: Optional[ClientOptions] = None,
        _userProvidedInstructions: Optional[str] = None,
        _tools: Optional[Dict[str, Any]] = None,
    ) -> AgentClient:
        raise StagehandSDKNotImplementedError("AgentProvider.getClient")


class V3Evaluator:
    def __init__(self, v3: "V3") -> None:
        self.v3 = v3

    def getClient(self) -> Any:
        raise StagehandSDKNotImplementedError("V3Evaluator.getClient")

    async def ask(self, _instruction: str, _options: Optional[Dict[str, Any]] = None) -> Any:
        raise StagehandSDKNotImplementedError("V3Evaluator.ask")

    async def batchAsk(self, _instructions: Iterable[Dict[str, Any]]) -> Any:
        raise StagehandSDKNotImplementedError("V3Evaluator.batchAsk")

    async def _evaluateWithMultipleScreenshots(self) -> Any:
        raise StagehandSDKNotImplementedError("V3Evaluator._evaluateWithMultipleScreenshots")


async def connectToMCPServer(
    _serverConfig: str | StdioServerConfig | ConnectToMCPServerOptions,
) -> MCPClient:
    raise StagehandSDKNotImplementedError("connectToMCPServer")


class _AgentExecutor:
    async def execute(
        self,
        _instructionOrOptions: str | AgentExecuteOptions,
        _page: Optional[AnyPage] = None,
    ) -> AgentResult:
        raise StagehandSDKNotImplementedError("V3.agent.execute")


class V3:
    """Python representation of the Stagehand V3 runtime stub."""

    llmClient: Optional[LLMClient]
    experimental: bool = False
    logInferenceToFile: bool = False
    disableAPI: bool = True
    verbose: int = 1
    browserbaseSessionId: Optional[str]

    def __init__(self, opts: Optional[Union[V3Options, Dict[str, Any]]] = None) -> None:
        if isinstance(opts, V3Options):
            self.opts = opts
        else:
            self.opts = V3Options(**(opts or {}))
        self.llmClient = None
        self.browserbaseSessionId = None
        self.stagehandMetrics = StagehandMetrics()
        self.historyEntries: List[HistoryEntry] = []
        self.currentMetrics = StagehandMetrics()

    @property
    def browserbaseSessionID(self) -> Optional[str]:
        return None

    @property
    def browserbaseSessionURL(self) -> Optional[str]:
        return None

    @property
    def browserbaseDebugURL(self) -> Optional[str]:
        return None

    async def metrics(self) -> StagehandMetrics:
        raise StagehandSDKNotImplementedError("V3.metrics")

    async def init(self) -> None:
        raise StagehandSDKNotImplementedError("V3.init")

    async def close(self, _opts: Optional[Dict[str, bool]] = None) -> None:
        raise StagehandSDKNotImplementedError("V3.close")

    async def act(self, _input: Union[str, Action], _options: Optional[ActOptions] = None) -> ActResult:
        raise StagehandSDKNotImplementedError("V3.act")

    async def extract(
        self,
        _instructionOrSchema: Optional[Union[str, JsonSchema]] = None,
        _schemaOrOptions: Optional[Union[JsonSchema, ExtractOptions]] = None,
        _maybeOptions: Optional[ExtractOptions] = None,
    ) -> Any:
        raise StagehandSDKNotImplementedError("V3.extract")

    async def observe(
        self,
        _instructionOrOptions: Optional[Union[str, ObserveOptions]] = None,
        _maybeOptions: Optional[ObserveOptions] = None,
    ) -> List[Action]:
        raise StagehandSDKNotImplementedError("V3.observe")

    def agent(self, _options: Optional[AgentConfig] = None) -> _AgentExecutor:
        return _AgentExecutor()

    def isAgentReplayActive(self) -> bool:
        return False

    def isAgentReplayRecording(self) -> bool:
        return False

    def beginAgentReplayRecording(self) -> None:
        return None

    def endAgentReplayRecording(self) -> List[AgentReplayStep]:
        raise StagehandSDKNotImplementedError("V3.endAgentReplayRecording")

    def discardAgentReplayRecording(self) -> None:
        return None

    def recordAgentReplayStep(self, _step: AgentReplayStep) -> None:
        return None

    async def history(self) -> Sequence[HistoryEntry]:
        return tuple(self.historyEntries)

    def addToHistory(self, functionName: Union[V3FunctionName, str], parameters: Dict[str, Any]) -> None:
        entry = HistoryEntry(
            functionName=functionName,
            parameters=parameters,
            timestamp=datetime.now(timezone.utc).isoformat(),
        )
        self.historyEntries.append(entry)

    def updateMetrics(self, partial: Union[StagehandMetrics, Mapping[str, Any]]) -> None:
        if isinstance(partial, StagehandMetrics):
            partial_dict = partial.model_dump(exclude_none=True)
        else:
            partial_dict = dict(partial)
        self.currentMetrics = self.currentMetrics.model_copy(update=partial_dict)
        self.stagehandMetrics = self.stagehandMetrics.model_copy(update=partial_dict)

    def updateTotalMetrics(self, partial: Union[StagehandMetrics, Mapping[str, Any]]) -> None:
        self.updateMetrics(partial)

    def connectURL(self) -> str:
        raise StagehandSDKNotImplementedError("V3.connectURL")

    @property
    def context(self) -> Any:
        raise StagehandSDKNotImplementedError("V3.context")

    @property
    def logger(self) -> Logger:
        def _logger(log: LogLine) -> None:  # pragma: no cover - stub placeholder
            raise StagehandSDKNotImplementedError("V3.logger")

        return _logger


class Stagehand(V3):
    """Convenience alias that mirrors the TS default export."""


__all__ = [
    "ConsoleMessage",
    "Response",
    "LLMClient",
    "AISdkClient",
    "AgentProvider",
    "V3Evaluator",
    "connectToMCPServer",
    "V3",
    "Stagehand",
]
