"""Python equivalents of the TypeScript SDK types."""

from __future__ import annotations

from enum import Enum
from typing import (
    Any,
    Callable,
    Dict,
    List,
    Literal,
    Mapping,
    Optional,
    Protocol,
    Union,
    runtime_checkable,
)

from pydantic import BaseModel, ConfigDict, Field

AvailableModel = str
AvailableCuaModel = str
ModelProvider = str
ClientOptions = Dict[str, Any]
AnyPage = Any
ToolUseItem = Dict[str, Any]
JsonSchemaDocument = Dict[str, Any]
JsonSchema = Dict[str, Any]
JsonSchemaProperty = Dict[str, Any]
MCPClient = Dict[str, Any]
ConsoleListener = Callable[[Any], None]
LoadState = Literal["load", "domcontentloaded", "networkidle"]
V3Env = Literal["LOCAL", "BROWSERBASE"]
LogLevel = Literal[0, 1, 2]


class ModelConfiguration(BaseModel):
    modelName: Optional[AvailableModel] = None
    clientOptions: Optional[ClientOptions] = None

    model_config = ConfigDict(extra="allow")


class AISDKProvider(BaseModel):
    name: str
    description: Optional[str] = None
    apiKeyEnv: Optional[str] = None
    baseUrl: Optional[str] = None

    model_config = ConfigDict(extra="allow")


class AISDKCustomProvider(AISDKProvider):
    headers: Optional[Dict[str, str]] = None


class LLMTool(BaseModel):
    type: str
    name: str
    description: Optional[str] = None
    parameters: Optional[Any] = None

    model_config = ConfigDict(extra="allow")


class Action(BaseModel):
    selector: Optional[str] = None
    method: Optional[str] = None
    arguments: Optional[List[str]] = None
    description: Optional[str] = None

    model_config = ConfigDict(extra="allow")


class ActResult(BaseModel):
    success: bool
    message: str
    actionDescription: Optional[str] = None
    actions: Optional[List[Action]] = None

    model_config = ConfigDict(extra="allow")


class HistoryEntry(BaseModel):
    functionName: str
    parameters: Dict[str, Any] = Field(default_factory=dict)
    timestamp: str

    model_config = ConfigDict(extra="allow")


class ActOptions(BaseModel):
    model: Optional[Union[ModelConfiguration, str]] = None
    variables: Optional[Dict[str, str]] = None
    timeout: Optional[int] = None
    page: Optional[AnyPage] = None

    model_config = ConfigDict(extra="allow")


class ExtractOptions(BaseModel):
    model: Optional[Union[ModelConfiguration, str]] = None
    timeout: Optional[int] = None
    selector: Optional[str] = None
    page: Optional[AnyPage] = None

    model_config = ConfigDict(extra="allow")


class ObserveOptions(BaseModel):
    model: Optional[Union[ModelConfiguration, str]] = None
    timeout: Optional[int] = None
    selector: Optional[str] = None
    page: Optional[AnyPage] = None

    model_config = ConfigDict(extra="allow")


class V3FunctionName(str, Enum):
    ACT = "ACT"
    EXTRACT = "EXTRACT"
    OBSERVE = "OBSERVE"
    AGENT = "AGENT"


class AgentAction(Action):
    pass


class AgentResult(BaseModel):
    success: bool
    steps: Optional[List[AgentAction]] = None
    output: Optional[str] = None

    model_config = ConfigDict(extra="allow")


class AgentExecuteOptions(BaseModel):
    instruction: str
    page: Optional[AnyPage] = None
    maxSteps: Optional[int] = None
    tools: Optional[Dict[str, Any]] = None

    model_config = ConfigDict(extra="allow")


class AgentExecutionOptions(BaseModel):
    instruction: str
    options: Optional[Union[AgentExecuteOptions, Dict[str, Any]]] = None

    model_config = ConfigDict(extra="allow")


AgentType = str
AgentProviderType = str


class AgentHandlerOptions(BaseModel):
    type: Optional[AgentType] = None
    model: Optional[Union[ModelConfiguration, str]] = None
    systemPrompt: Optional[str] = None

    model_config = ConfigDict(extra="allow")


class ActionExecutionResult(BaseModel):
    action: AgentAction
    success: bool
    error: Optional[str] = None

    model_config = ConfigDict(extra="allow")


class ZodPathSegments(BaseModel):
    segments: List[Union[str, int]]


class StagehandZodSchema(BaseModel):
    kind: Optional[str] = None
    shape: Optional[Dict[str, Any]] = None

    model_config = ConfigDict(extra="allow")


class StagehandZodObject(StagehandZodSchema):
    pass


InferStagehandSchema = Any
ExtractResult = Any


class AnthropicContentBlock(BaseModel):
    type: str
    text: Optional[str] = None
    id: Optional[str] = None

    model_config = ConfigDict(extra="allow")


class AnthropicTextBlock(AnthropicContentBlock):
    type: Literal["text"] = "text"
    text: str


class AnthropicToolResult(BaseModel):
    type: Literal["tool_result"] = "tool_result"
    result: Optional[Any] = None

    model_config = ConfigDict(extra="allow")


class AnthropicMessage(BaseModel):
    id: Optional[str] = None
    role: Optional[str] = None
    content: Optional[List[AnthropicContentBlock]] = None

    model_config = ConfigDict(extra="allow")


class AgentInstance(Protocol):
    async def execute(self, options: AgentExecutionOptions) -> AgentResult:
        ...


class AgentModelConfig(BaseModel):
    modelName: AvailableModel
    provider: Optional[AgentProviderType] = None

    model_config = ConfigDict(extra="allow")


class AgentConfig(AgentHandlerOptions):
    executionModel: Optional[Union[ModelConfiguration, str]] = None
    cua: Optional[bool] = None
    tools: Optional[Dict[str, Any]] = None
    integrations: Optional[List[Any]] = None


@runtime_checkable
class AgentClient(Protocol):
    async def execute(self, options: AgentExecutionOptions) -> AgentResult:
        ...


class AuxiliaryLogValue(BaseModel):
    value: str
    type: Literal["object", "string", "html", "integer", "float", "boolean"]


class LogLine(BaseModel):
    id: Optional[str] = None
    category: Optional[str] = None
    message: str
    level: Optional[LogLevel] = None
    timestamp: Optional[str] = None
    auxiliary: Optional[Dict[str, AuxiliaryLogValue]] = None

    model_config = ConfigDict(extra="allow")


Logger = Callable[[LogLine], None]


class StagehandMetrics(BaseModel):
    totalPromptTokens: Optional[int] = None
    totalCompletionTokens: Optional[int] = None
    totalReasoningTokens: Optional[int] = None
    totalCachedInputTokens: Optional[int] = None
    totalInferenceTimeMs: Optional[int] = None

    model_config = ConfigDict(extra="allow")


class ViewportConfig(BaseModel):
    width: int
    height: int


class ProxyConfig(BaseModel):
    server: Optional[str] = None
    bypass: Optional[str] = None


class LocalBrowserLaunchOptions(BaseModel):
    args: Optional[List[str]] = None
    executablePath: Optional[str] = None
    userDataDir: Optional[str] = None
    headless: Optional[bool] = None
    devtools: Optional[bool] = None
    locale: Optional[str] = None
    viewport: Optional[ViewportConfig] = None
    deviceScaleFactor: Optional[int] = None
    hasTouch: Optional[bool] = None
    ignoreHTTPSErrors: Optional[bool] = None
    proxy: Optional[ProxyConfig] = None
    preserveUserDataDir: Optional[bool] = None
    connectTimeoutMs: Optional[int] = None
    downloadsPath: Optional[str] = None
    acceptDownloads: Optional[bool] = None

    model_config = ConfigDict(extra="allow")


class V3Options(BaseModel):
    env: Optional[V3Env] = None
    apiKey: Optional[str] = None
    projectId: Optional[str] = None
    cacheDir: Optional[str] = None
    logger: Optional[Logger] = None
    systemPrompt: Optional[str] = None
    verbose: Optional[LogLevel] = None
    model: Optional[Union[ModelConfiguration, str]] = None
    llmClient: Optional[Any] = None
    selfHeal: Optional[bool] = None
    disableAPI: Optional[bool] = None
    browserbaseSessionID: Optional[str] = None
    browserbaseSessionCreateParams: Optional[Dict[str, Any]] = None

    model_config = ConfigDict(arbitrary_types_allowed=True, extra="allow")


AnyPage = Any


class ChatMessageImageSource(BaseModel):
    type: str
    media_type: str
    data: str


class ChatMessageImageContent(BaseModel):
    type: str
    image_url: Optional[Dict[str, str]] = None
    text: Optional[str] = None
    source: Optional[ChatMessageImageSource] = None

    model_config = ConfigDict(extra="allow")


class ChatMessageTextContent(BaseModel):
    type: str
    text: str

    model_config = ConfigDict(extra="allow")


ChatMessageContent = Union[str, List[Union[ChatMessageImageContent, ChatMessageTextContent]]]


class ChatMessage(BaseModel):
    role: Literal["system", "user", "assistant"]
    content: ChatMessageContent

    model_config = ConfigDict(extra="allow")


class ChatCompletionResponseModel(BaseModel):
    name: str
    schema: Optional[StagehandZodSchema] = None

    model_config = ConfigDict(extra="allow")


class ChatCompletionImagePayload(BaseModel):
    buffer: bytes
    description: Optional[str] = None

    model_config = ConfigDict(extra="allow")


class ChatCompletionOptions(BaseModel):
    messages: List[ChatMessage]
    temperature: Optional[float] = None
    top_p: Optional[float] = None
    frequency_penalty: Optional[float] = None
    presence_penalty: Optional[float] = None
    image: Optional[ChatCompletionImagePayload] = None
    response_model: Optional[ChatCompletionResponseModel] = None
    tools: Optional[List[LLMTool]] = None
    tool_choice: Optional[Literal["auto", "none", "required"]] = None
    maxOutputTokens: Optional[int] = None
    requestId: Optional[str] = None

    model_config = ConfigDict(extra="allow")


class LLMUsage(BaseModel):
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int
    reasoning_tokens: Optional[int] = None
    cached_input_tokens: Optional[int] = None

    model_config = ConfigDict(extra="allow")


class LLMToolCallFunction(BaseModel):
    name: str
    arguments: str


class LLMToolCall(BaseModel):
    id: str
    type: str
    function: LLMToolCallFunction

    model_config = ConfigDict(extra="allow")


class LLMChoiceMessage(BaseModel):
    role: str
    content: Optional[str] = None
    tool_calls: Optional[List[LLMToolCall]] = None

    model_config = ConfigDict(extra="allow")


class LLMChoice(BaseModel):
    index: int
    message: LLMChoiceMessage
    finish_reason: Optional[str] = None

    model_config = ConfigDict(extra="allow")


class LLMResponse(BaseModel):
    id: str
    object: str
    created: int
    model: str
    choices: List[LLMChoice]
    usage: LLMUsage

    model_config = ConfigDict(extra="allow")


class CreateChatCompletionOptions(BaseModel):
    options: ChatCompletionOptions
    logger: Logger
    retries: Optional[int] = None

    model_config = ConfigDict(arbitrary_types_allowed=True)


class LLMParsedResponse(BaseModel):
    data: Any
    usage: Optional[LLMUsage] = None

    model_config = ConfigDict(extra="allow")


class ObserveResult(BaseModel):
    actions: List[Action]

    model_config = ConfigDict(extra="allow")


class AgentReplayStep(BaseModel):
    type: str
    payload: Optional[Any] = None

    model_config = ConfigDict(extra="allow")


class ConnectToMCPServerOptions(BaseModel):
    serverUrl: Union[str, Any]
    clientOptions: Optional[ClientOptions] = None

    model_config = ConfigDict(extra="allow")


class StdioServerConfig(BaseModel):
    command: str
    args: Optional[List[str]] = None
    env: Optional[Dict[str, str]] = None

    model_config = ConfigDict(extra="allow")


__all__ = [
    "AvailableModel",
    "AvailableCuaModel",
    "ModelProvider",
    "ClientOptions",
    "ModelConfiguration",
    "AISDKProvider",
    "AISDKCustomProvider",
    "LLMTool",
    "Action",
    "ActResult",
    "HistoryEntry",
    "ActOptions",
    "ExtractOptions",
    "ObserveOptions",
    "V3FunctionName",
    "AgentAction",
    "AgentResult",
    "AgentExecuteOptions",
    "AgentExecutionOptions",
    "AgentHandlerOptions",
    "ActionExecutionResult",
    "ZodPathSegments",
    "AnthropicMessage",
    "AnthropicTextBlock",
    "AnthropicToolResult",
    "AgentInstance",
    "AgentModelConfig",
    "AgentConfig",
    "AgentType",
    "AgentProviderType",
    "AgentClient",
    "LogLine",
    "Logger",
    "StagehandMetrics",
    "ViewportConfig",
    "ProxyConfig",
    "LocalBrowserLaunchOptions",
    "V3Options",
    "AnyPage",
    "ChatMessage",
    "ChatCompletionOptions",
    "LLMResponse",
    "CreateChatCompletionOptions",
    "LLMUsage",
    "LLMToolCall",
    "LLMToolCallFunction",
    "StagehandZodSchema",
    "StagehandZodObject",
    "InferStagehandSchema",
    "ExtractResult",
    "JsonSchema",
    "JsonSchemaDocument",
    "JsonSchemaProperty",
    "ObserveResult",
    "AgentReplayStep",
    "ConnectToMCPServerOptions",
    "StdioServerConfig",
    "ConsoleListener",
    "LoadState",
    "ToolUseItem",
    "V3Env",
    "LogLevel",
    "MCPClient",
]
