import { connectRPCClient, type RPCClient, type RPCClientOptions } from "./rpcClient.js";
import { StagehandInitParamsSchema } from "../../protocol/schemas.js";
import { StagehandMethods } from "../../protocol/schema-registry.js";
import type {
  ActResultData,
  Action,
  BrowserGetVersionResult,
  RuntimeLoopbackStatusResult,
  StagehandMetrics,
  StagehandPingResult,
  StagehandRpcNotification,
} from "../../protocol/types.js";
import { z } from "zod/v4";
import { BrowserContext } from "./browserContext.js";
import type { ResolvedBrowserSource } from "./browserSource.shared.js";
import {
  StagehandClientActOptionsSchema,
  StagehandClientExtractOptionsSchema,
  StagehandClientInitParamsSchema,
  StagehandClientObserveOptionsSchema,
  type StagehandClientActOptions,
  type StagehandClientExtractOptions,
  type ResolvedStagehandClientLoggingConfig,
  type ResolvedStagehandClientInitParams,
  type StagehandClientInitParams,
  type StagehandClientObserveOptions,
} from "./clientSchemas.js";
import { CDPConnectionClosedError } from "./cdpClient.js";

type StagehandAdapters = {
  resolveBrowserSource: (
    initParams: ResolvedStagehandClientInitParams,
  ) => Promise<ResolvedBrowserSource>;
  connectRpcClient?: (options: RPCClientOptions) => Promise<RPCClient>;
};

export class Stagehand<InitParams> {
  browserContext: BrowserContext | undefined;
  isInitialized = false;
  rpcClient: RPCClient | undefined;
  removeNotificationListener: (() => void) | undefined;
  removeClientLLMHandler: (() => void) | undefined;
  private resolvedBrowser: ResolvedBrowserSource | undefined;
  closePromise: Promise<void> | undefined;

  constructor(
    readonly initParams: InitParams,
    private readonly resolvedInitParams: ResolvedStagehandClientInitParams,
    private readonly adapters: StagehandAdapters,
  ) {}

  get context(): BrowserContext {
    if (!this.browserContext) {
      throw new Error("Stagehand is not initialized. Call stagehand.init() before using context.");
    }
    return this.browserContext;
  }

  get browser(): ResolvedBrowserSource {
    if (!this.resolvedBrowser) {
      throw new Error("Stagehand is not initialized. Call stagehand.init() before using browser.");
    }
    return this.resolvedBrowser;
  }

  get initialized(): boolean {
    return this.isInitialized;
  }

  async ping(): Promise<StagehandPingResult> {
    return this.connectedRpcClient.send(StagehandMethods.ping, {});
  }

  async runtimeLoopbackStatus(): Promise<RuntimeLoopbackStatusResult> {
    return this.connectedRpcClient.send(StagehandMethods.runtimeLoopbackStatus, {});
  }

  async browserGetVersion(): Promise<BrowserGetVersionResult> {
    return this.connectedRpcClient.send(StagehandMethods.browserGetVersion, {});
  }

  async metrics(): Promise<StagehandMetrics> {
    return this.connectedRpcClient.send(StagehandMethods.stagehandMetrics, {});
  }

  async init(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    const clientInitParams = this.resolvedInitParams;
    const browser = await this.adapters.resolveBrowserSource(clientInitParams);
    this.resolvedBrowser = browser;

    try {
      const rpcClient = await (this.adapters.connectRpcClient ?? connectRPCClient)({
        cdpUrl: browser.cdpUrl,
        // TODO: Thread browser.cdpHeaders through CDP discovery and the WebSocket handshake.
        serviceWorkerUrlIncludes: "service-worker.js",
        telemetry: clientInitParams.telemetry,
        logLevel: clientInitParams.logging.level,
      });
      this.rpcClient = rpcClient;
      this.removeNotificationListener = rpcClient.onNotification((notification) =>
        handleStagehandNotification(notification, clientInitParams.logging),
      );
      if (clientInitParams.model && "generate" in clientInitParams.model) {
        this.removeClientLLMHandler = rpcClient.onRequest(
          StagehandMethods.llmGenerate,
          clientInitParams.model.generate,
        );
      }

      await rpcClient.send(
        StagehandMethods.stagehandInit,
        stagehandInitParamsForWorker(clientInitParams, browser),
      );
      this.browserContext = new BrowserContext(rpcClient);
    } catch (error) {
      this.removeClientLLMHandler?.();
      this.removeClientLLMHandler = undefined;
      this.removeNotificationListener?.();
      this.removeNotificationListener = undefined;
      this.rpcClient?.close();
      this.rpcClient = undefined;
      try {
        await this.closeBrowserSource();
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          "Stagehand initialization failed and browser cleanup also failed",
          { cause: error },
        );
      }
      throw error;
    }

    this.isInitialized = true;
    this.closePromise = undefined;
  }

  async act(input: string, options?: StagehandClientActOptions): Promise<ActResultData> {
    const { page, ...protocolOptions } = StagehandClientActOptionsSchema.parse(options ?? {});
    const targetPage = page ?? (await this.context.activePage());
    if (!targetPage) throw new Error("Stagehand has no active page.");
    const response = await this.connectedRpcClient.send(StagehandMethods.stagehandAct, {
      pageId: targetPage.pageId,
      input,
      ...(options === undefined ? {} : { options: protocolOptions }),
    });

    return response.result;
  }

  async observe(instruction?: string, options?: StagehandClientObserveOptions): Promise<Action[]> {
    const { page, ...protocolOptions } = StagehandClientObserveOptionsSchema.parse(options ?? {});
    const targetPage = page ?? (await this.context.activePage());
    if (!targetPage) throw new Error("Stagehand has no active page.");
    const response = await this.connectedRpcClient.send(StagehandMethods.stagehandObserve, {
      pageId: targetPage.pageId,
      ...(instruction === undefined ? {} : { instruction }),
      ...(options === undefined ? {} : { options: protocolOptions }),
    });

    return response.result;
  }

  async extract<Schema extends z.ZodType>(
    instruction: string,
    schema: Schema,
    options?: StagehandClientExtractOptions,
  ): Promise<z.output<Schema>> {
    const { page, ...protocolOptions } = StagehandClientExtractOptionsSchema.parse(options ?? {});
    const targetPage = page ?? (await this.context.activePage());
    if (!targetPage) throw new Error("Stagehand has no active page.");
    const jsonSchema = z.json().parse(z.toJSONSchema(schema));
    const response = await this.connectedRpcClient.send(StagehandMethods.stagehandExtract, {
      pageId: targetPage.pageId,
      instruction,
      schema: jsonSchema,
      ...(options === undefined ? {} : { options: protocolOptions }),
    });

    return schema.parse(response.result);
  }

  close(): Promise<void> {
    this.closePromise ??= (async () => {
      const context = this.browserContext;
      try {
        if (context) {
          try {
            await this.rpcClient?.send(StagehandMethods.stagehandClose, {});
          } catch (error) {
            if (!(error instanceof CDPConnectionClosedError)) throw error;
          }
        }
      } finally {
        this.removeClientLLMHandler?.();
        this.removeClientLLMHandler = undefined;
        this.removeNotificationListener?.();
        this.removeNotificationListener = undefined;
        this.rpcClient?.close();
        await this.closeBrowserSource();
        this.rpcClient = undefined;
        this.browserContext = undefined;
        this.isInitialized = false;
      }
    })();
    return this.closePromise;
  }

  private get connectedRpcClient(): RPCClient {
    if (!this.isInitialized || !this.rpcClient) {
      throw new Error("Stagehand is not initialized. Call stagehand.init() before using it.");
    }
    return this.rpcClient;
  }

  private async closeBrowserSource(): Promise<void> {
    const browser = this.resolvedBrowser;
    this.resolvedBrowser = undefined;
    if (!browser || browser.keepAlive) {
      return;
    }
    await browser.close?.();
  }
}

export { Stagehand as StagehandCore };

function stagehandInitParamsForWorker(
  initParams: ResolvedStagehandClientInitParams,
  resolvedBrowser: ResolvedBrowserSource,
) {
  const { browser, logging: _logging, model, ...protocolParams } = initParams;
  const protocolModel = model && "generate" in model ? { source: "client" as const } : model;

  if (browser.type === "browserbase" && !resolvedBrowser.browserbaseSessionId) {
    throw new Error("Resolved Browserbase source is missing its session ID");
  }

  return StagehandInitParamsSchema.parse({
    ...protocolParams,
    ...(browser.type === "browserbase"
      ? {
          browser: {
            ...browser,
            sessionId: resolvedBrowser.browserbaseSessionId,
          },
        }
      : {}),
    ...(protocolModel === undefined ? {} : { model: protocolModel }),
  });
}

export function createStagehandWithClientForTest(
  client: RPCClient,
): Stagehand<StagehandClientInitParams> {
  return createStagehandWithDependenciesForTest(
    {
      browser: {
        type: "cdp",
        cdpUrl: "test://stagehand",
      },
    },
    {
      resolveBrowserSource: async () => ({
        cdpUrl: "test://stagehand",
        keepAlive: true,
      }),
      connectRpcClient: async () => client,
    },
  );
}

const LOG_LEVEL_PRIORITY = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  off: Number.POSITIVE_INFINITY,
} as const;

function handleStagehandNotification(
  notification: StagehandRpcNotification,
  logging: ResolvedStagehandClientLoggingConfig,
): void {
  const log = notification.params;
  if (LOG_LEVEL_PRIORITY[log.level] < LOG_LEVEL_PRIORITY[logging.level]) return;

  process.stderr.write(renderStagehandLog(log, logging.format) + "\n");
  if (!logging.onLog) return;

  try {
    const result = logging.onLog(log);
    if (result instanceof Promise) {
      void result.catch(reportOnLogError);
    }
  } catch (error) {
    reportOnLogError(error);
  }
}

function renderStagehandLog(
  log: StagehandRpcNotification["params"],
  format: ResolvedStagehandClientLoggingConfig["format"],
): string {
  if (format === "json") return JSON.stringify(log);

  const data = Object.keys(log.data).length === 0 ? "" : ` ${JSON.stringify(log.data)}`;
  return `[stagehand] ${log.level.toUpperCase()} ${log.message}${data}`;
}

function reportOnLogError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`[stagehand] ERROR onLog callback failed: ${message}\n`);
}

export function createStagehandWithDependenciesForTest(
  initParams: StagehandClientInitParams,
  adapters: StagehandAdapters,
): Stagehand<StagehandClientInitParams> {
  return new Stagehand(initParams, StagehandClientInitParamsSchema.parse(initParams), adapters);
}
