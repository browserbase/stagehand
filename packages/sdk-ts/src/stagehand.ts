import { configureRPCClient, type RPCClient } from "./rpcClient.js";
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
import {
  claimStagehandBrowser,
  isStagehandBrowser,
  type ClaimedStagehandBrowser,
  type StagehandBrowser,
} from "../../browser/src/index.js";
import {
  StagehandClientActOptionsSchema,
  StagehandClientExtractOptionsSchema,
  StagehandClientCreateConfigSchema,
  StagehandClientObserveOptionsSchema,
  type StagehandClientActOptions,
  type StagehandClientExtractOptions,
  type ResolvedStagehandClientLoggingConfig,
  type ResolvedStagehandClientCreateConfig,
  type StagehandCreateOptions,
  type StagehandClientObserveOptions,
} from "./clientSchemas.js";
import { CDPConnectionClosedError } from "./cdpClient.js";

export class Stagehand {
  browserContext: BrowserContext | undefined;
  isInitialized = false;
  rpcClient: RPCClient | undefined;
  removeNotificationListener: (() => void) | undefined;
  removeClientLLMHandler: (() => void) | undefined;
  closePromise: Promise<void> | undefined;

  private constructor(
    readonly browser: StagehandBrowser,
    readonly initParams: ResolvedStagehandClientCreateConfig,
  ) {}

  /** @internal */
  static createWithClientForTest(client: RPCClient): Stagehand {
    const browser = {
      provider: "local",
      origin: "connected",
      closed: false,
      close: async () => {},
    } as StagehandBrowser;
    const stagehand = new Stagehand(browser, StagehandClientCreateConfigSchema.parse({}));
    stagehand.rpcClient = client;
    stagehand.browserContext = new BrowserContext(client);
    stagehand.isInitialized = true;
    return stagehand;
  }

  static async create(input: StagehandCreateOptions): Promise<Stagehand> {
    if (typeof input !== "object" || input === null || !("browser" in input)) {
      throw new TypeError("Stagehand.create requires a browser");
    }
    const { browser, ...config } = input;
    if (!isStagehandBrowser(browser)) {
      throw new TypeError("browser must be created by localBrowser or browserbase");
    }
    const initParams = StagehandClientCreateConfigSchema.parse(config);
    const claimedBrowser = claimStagehandBrowser(browser);
    const stagehand = new Stagehand(browser, initParams);
    await stagehand.initialize(claimedBrowser);
    return stagehand;
  }

  get context(): BrowserContext {
    if (!this.browserContext) {
      throw new Error("Stagehand is not initialized. Use await Stagehand.create() first.");
    }
    return this.browserContext;
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

  private async initialize(browser: ClaimedStagehandBrowser): Promise<void> {
    try {
      const rpcClient = await configureRPCClient(browser.cdpClient, {
        commandTimeoutMs: browser.commandTimeoutMs,
        telemetry: this.initParams.telemetry,
        logLevel: this.initParams.logging.level,
        closeTransportOnFailure: false,
      });
      this.rpcClient = rpcClient;
      this.removeNotificationListener = rpcClient.onNotification((notification) =>
        handleStagehandNotification(notification, this.initParams.logging),
      );
      if (this.initParams.model && "generate" in this.initParams.model) {
        this.removeClientLLMHandler = rpcClient.onRequest(
          StagehandMethods.llmGenerate,
          this.initParams.model.generate,
        );
      }

      await rpcClient.send(
        StagehandMethods.stagehandInit,
        stagehandInitParamsForWorker(this.initParams, browser.workerInitMetadata),
      );
      this.browserContext = new BrowserContext(rpcClient);
    } catch (error) {
      this.removeClientLLMHandler?.();
      this.removeClientLLMHandler = undefined;
      this.removeNotificationListener?.();
      this.removeNotificationListener = undefined;
      this.rpcClient?.close(new Error("Stagehand initialization failed"), {
        closeTransport: false,
      });
      this.rpcClient = undefined;
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
        this.rpcClient?.close(new Error("Stagehand closed"), { closeTransport: false });
        this.rpcClient = undefined;
        this.browserContext = undefined;
        this.isInitialized = false;
      }
    })();
    return this.closePromise;
  }

  private get connectedRpcClient(): RPCClient {
    if (!this.isInitialized || !this.rpcClient) {
      throw new Error("Stagehand is not initialized. Use await Stagehand.create() first.");
    }
    return this.rpcClient;
  }
}

function stagehandInitParamsForWorker(
  initParams: ResolvedStagehandClientCreateConfig,
  browserMetadata: ClaimedStagehandBrowser["workerInitMetadata"],
) {
  const { logging: _logging, model, ...protocolParams } = initParams;
  const protocolModel = model && "generate" in model ? { source: "client" as const } : model;

  return StagehandInitParamsSchema.parse({
    ...protocolParams,
    ...browserMetadata,
    ...(protocolModel === undefined ? {} : { model: protocolModel }),
  });
}

export function createStagehandWithClientForTest(client: RPCClient): Stagehand {
  return Stagehand.createWithClientForTest(client);
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
