import path from "node:path";
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
  AvailableModel: true,
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
  BrowserClipboard: "method-bearing SDK interface",
  ConsoleListener: "callback type",
  Response: "runtime response class/value type",
} as const;

function getPublicTypeExports() {
  const root = process.cwd();
  const configPath = ts.findConfigFile(
    root,
    ts.sys.fileExists,
    "packages/protocol/tsconfig.test.json",
  );

  if (!configPath) {
    throw new Error("Could not find public API test tsconfig");
  }

  const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, path.dirname(configPath));
  const entry = path.join(root, "packages/server/types/public/index.ts");
  const program = ts.createProgram([...parsed.fileNames, entry], parsed.options);
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
