import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vite-plus/test";

const schemaBackedPublicTypes = {
  Action: true,
  ActOptions: true,
  ActResult: true,
  ActResultData: true,
  AnthropicClientOptions: true,
  ApiKeyAuth: true,
  ApiKeyClientOptions: true,
  ApiKeyResolvedProviderClientOptions: true,
  AzureApiKeyClientOptions: true,
  AzureEntraClientOptions: true,
  AzureEntraIdAuth: true,
  AzureProviderOptions: true,
  AzureResolvedProviderClientOptions: true,
  BrowserbaseRegion: true,
  ClearCookieOptions: true,
  ClientOptions: true,
  ClientOptionsBase: true,
  ClipboardOptions: true,
  ClipboardPasteOptions: true,
  Cookie: true,
  CookieParam: true,
  DomainPolicy: true,
  ExtractOptions: true,
  ExtractResult: true,
  GoogleServiceAccountAuth: true,
  GoogleServiceAccountCredentials: true,
  HistoryEntry: true,
  LLMTool: true,
  LoadState: true,
  LocalBrowserLaunchOptions: true,
  Locator: true,
  LocatorCoordinates: true,
  LogLevel: true,
  LogLine: true,
  ModelAuth: true,
  ModelConfiguration: true,
  ModelName: true,
  ModelProvider: true,
  ModelProviderOptions: true,
  ObserveOptions: true,
  ObserveResult: true,
  OllamaResolvedProviderClientOptions: true,
  OpenAIClientOptions: true,
  PageSnapshotOptions: true,
  PageLocator: true,
  ResolvedProviderClientOptions: true,
  SnapshotResult: true,
  StagehandMetrics: true,
  ThinkingEffort: true,
  V3Env: true,
  V3FunctionName: true,
  V3Options: true,
  VariablePrimitive: true,
  VariableValue: true,
  Variables: true,
  VertexClientOptions: true,
  VertexProviderOptions: true,
  VertexResolvedProviderClientOptions: true,
} as const;

const publicTypesWithoutSchemas = {
  ActTimeoutError: "public error class",
  BrowserClipboard: "method-bearing SDK interface",
  BrowserbaseSessionNotFoundError: "public error class",
  CaptchaTimeoutError: "public error class",
  CdpConnectionClosedError: "public error class",
  ConnectionTimeoutError: "public error class",
  ConsoleListener: "callback type",
  ConsoleMessage: "runtime console message class/value type",
  ContentFrameNotFoundError: "public error class",
  CookieSetError: "public error class",
  CookieValidationError: "public error class",
  CreateChatCompletionResponseError: "public error class",
  ElementNotVisibleError: "public error class",
  ExperimentalApiConflictError: "public error class",
  ExperimentalNotConfiguredError: "public error class",
  ExtractTimeoutError: "public error class",
  HandlerNotInitializedError: "public error class",
  InvalidAISDKModelFormatError: "public error class",
  LLMResponseError: "public error class",
  MissingLLMConfigurationError: "public error class",
  ObserveTimeoutError: "public error class",
  PageNotFoundError: "public error class",
  Response: "runtime response class/value type",
  ResponseBodyError: "public error class",
  ResponseParseError: "public error class",
  StagehandClickError: "public error class",
  StagehandClosedError: "public error class",
  StagehandDefaultError: "public error class",
  StagehandDomProcessError: "public error class",
  StagehandElementNotFoundError: "public error class",
  StagehandEnvironmentError: "public error class",
  StagehandError: "public error class",
  StagehandEvalError: "public error class",
  StagehandIframeError: "public error class",
  StagehandInitError: "public error class",
  StagehandInvalidArgumentError: "public error class",
  StagehandLocatorError: "public error class",
  StagehandMissingArgumentError: "public error class",
  StagehandNotInitializedError: "public error class",
  StagehandSetDomainPolicyError: "public error class",
  StagehandSetExtraHTTPHeadersError: "public error class",
  StagehandShadowRootMissingError: "public error class",
  StagehandShadowSegmentEmptyError: "public error class",
  StagehandShadowSegmentNotFoundError: "public error class",
  StagehandSnapshotError: "public error class",
  StagehandUnsupportedBrowserFeatureError: "public error class",
  TimeoutError: "public error class",
  UnderstudyCommandException: "public error class",
  UnsupportedAISDKModelProviderError: "public error class",
  UnsupportedModelError: "public error class",
  UnsupportedModelProviderError: "public error class",
  XPathResolutionError: "public error class",
  ZodSchemaValidationError: "public error class",
} as const;

function getPublicTypeExports() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
  const configPath = ts.findConfigFile(
    root,
    (fileName) => ts.sys.fileExists(fileName),
    "packages/protocol/tsconfig.test.json",
  );

  if (!configPath) {
    throw new Error("Could not find public API test tsconfig");
  }

  const configFile = ts.readConfigFile(configPath, (fileName) => ts.sys.readFile(fileName));
  const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, path.dirname(configPath));
  const entry = path.join(root, "packages/server/types/public/index.ts");
  const program = ts.createProgram([entry], parsed.options);
  const checker = program.getTypeChecker();
  const sourceFile = program.getSourceFile(entry);

  if (!sourceFile) {
    throw new Error("Could not load public API index");
  }

  const moduleSymbol = checker.getSymbolAtLocation(sourceFile);

  if (!moduleSymbol) {
    throw new Error("Could not resolve public API index module symbol");
  }

  return checker
    .getExportsOfModule(moduleSymbol)
    .filter((symbol) => {
      const resolved =
        symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;

      return Boolean(resolved.flags & ts.SymbolFlags.Type);
    })
    .map((symbol) => symbol.name)
    .sort();
}

describe("Stagehand public type schema coverage", () => {
  it("accounts for every public TypeScript type export", () => {
    const actual = getPublicTypeExports();
    const accountedFor = [
      ...Object.keys(schemaBackedPublicTypes),
      ...Object.keys(publicTypesWithoutSchemas),
    ].sort();

    expect(actual).toStrictEqual(accountedFor);
  });
});
