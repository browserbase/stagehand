import { RPCClient } from "./rpcClient.js";
import { STAGEHAND_PROTOCOL_VERSION, StagehandInitParamsSchema } from "../../protocol/schemas.js";
import { StagehandMethods } from "../../protocol/schema-registry.js";
import type {
  Action,
  ActResult,
  ObserveResult,
  StagehandMetrics,
  StagehandRpcNotification,
} from "../../protocol/types.js";
import { z } from "zod/v4";
import { BrowserContext } from "./browserContext.js";
import {
  StagehandClientActOptionsSchema,
  StagehandClientExtractOptionsSchema,
  StagehandCreateOptionsSchema,
  StagehandClientObserveOptionsSchema,
  type StagehandClientActOptions,
  type StagehandClientExtractOptions,
  type ResolvedStagehandClientLoggingConfig,
  type ResolvedStagehandClientCreateConfig,
  type StagehandCreateOptions,
  type StagehandClientObserveOptions,
} from "./clientSchemas.js";
import { CDPConnectionClosedError } from "./cdpClient.js";
import { STAGEHAND_SDK_CLIENT_INFO } from "./sdkIdentity.js";
import {
  claimStagehandBrowser,
  releaseStagehandBrowser,
  type ClaimedStagehandBrowser,
  type StagehandBrowser,
} from "./browser/factories.js";

type ProtocolExtractResult = import("../../protocol/types.js").ExtractResult;

export type ExtractResult<Schema extends z.ZodType> = Omit<ProtocolExtractResult, "data"> & {
  data: z.output<Schema>;
};

export class Stagehand {
  browserContext: BrowserContext | undefined;
  isInitialized = false;
  rpcClient: RPCClient | undefined;
  removeNotificationListener: (() => void) | undefined;
  removeClientLLMHandler: (() => void) | undefined;
  closePromise: Promise<void> | undefined;

  private constructor(
    private readonly browserHandle: StagehandBrowser,
    readonly initParams: ResolvedStagehandClientCreateConfig,
  ) {}

  static async create(input: StagehandCreateOptions): Promise<Stagehand> {
    const { browser, ...initParams } = StagehandCreateOptionsSchema.parse(input);
    const claimedBrowser = claimStagehandBrowser(browser);
    const stagehand = new Stagehand(browser, initParams);
    try {
      await stagehand.initialize(claimedBrowser);
      return stagehand;
    } catch (error) {
      releaseStagehandBrowser(browser);
      throw error;
    }
  }

  get context(): BrowserContext {
    if (!this.browserContext) {
      throw new Error("Stagehand is not initialized. Use await Stagehand.create() first.");
    }
    return this.browserContext;
  }

  get browser(): StagehandBrowser {
    return this.browserHandle;
  }

  get initialized(): boolean {
    return this.isInitialized;
  }

  async metrics(): Promise<StagehandMetrics> {
    return this.connectedRpcClient.send(StagehandMethods.stagehandMetrics, {});
  }

  private async initialize(browser: ClaimedStagehandBrowser): Promise<void> {
    const createConfig = this.initParams;
    const rpcClient = new RPCClient(browser.cdpClient, browser.commandTimeoutMs);
    this.rpcClient = rpcClient;

    try {
      this.removeNotificationListener = rpcClient.onNotification((notification) =>
        handleStagehandNotification(notification, createConfig.logging),
      );
      if (createConfig.model && "generate" in createConfig.model) {
        this.removeClientLLMHandler = rpcClient.onRequest(
          StagehandMethods.llmGenerate,
          createConfig.model.generate,
        );
      }

      await rpcClient.send(
        StagehandMethods.stagehandInit,
        stagehandCreateParamsForWorker(createConfig, browser),
      );
      this.browserContext = new BrowserContext(rpcClient);
    } catch (error) {
      this.removeClientLLMHandler?.();
      this.removeClientLLMHandler = undefined;
      this.removeNotificationListener?.();
      this.removeNotificationListener = undefined;
      rpcClient.close(new Error("Stagehand initialization failed", { cause: error }), {
        closeTransport: false,
      });
      this.rpcClient = undefined;
      throw error;
    }

    this.isInitialized = true;
    this.closePromise = undefined;
  }

  async act(instruction: string, options?: StagehandClientActOptions): Promise<ActResult>;
  async act(instruction: Action, options?: StagehandClientActOptions): Promise<ActResult>;
  async act(instruction: string | Action, options?: StagehandClientActOptions): Promise<ActResult> {
    const { page, ...protocolOptions } = StagehandClientActOptionsSchema.parse(options ?? {});
    const targetPage = page ?? (await this.context.activePage());
    if (!targetPage) throw new Error("Stagehand has no active page.");
    const response = await this.connectedRpcClient.send(StagehandMethods.stagehandAct, {
      pageId: targetPage.pageId,
      instruction,
      ...(options === undefined ? {} : { options: protocolOptions }),
    });

    return response;
  }

  async observe(
    instruction?: string,
    options?: StagehandClientObserveOptions,
  ): Promise<ObserveResult> {
    const { page, ...protocolOptions } = StagehandClientObserveOptionsSchema.parse(options ?? {});
    const targetPage = page ?? (await this.context.activePage());
    if (!targetPage) throw new Error("Stagehand has no active page.");
    const response = await this.connectedRpcClient.send(StagehandMethods.stagehandObserve, {
      pageId: targetPage.pageId,
      ...(instruction === undefined ? {} : { instruction }),
      ...(options === undefined ? {} : { options: protocolOptions }),
    });

    return response;
  }

  async extract<Schema extends z.ZodType>(
    instruction: string,
    schema: Schema,
    options?: StagehandClientExtractOptions,
  ): Promise<ExtractResult<Schema>> {
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

    return {
      ...response,
      data: schema.parse(response.data),
    };
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

function stagehandCreateParamsForWorker(
  createConfig: ResolvedStagehandClientCreateConfig,
  browser: ClaimedStagehandBrowser,
) {
  const { logging, model, ...protocolParams } = createConfig;
  const protocolModel = model && "generate" in model ? { source: "client" as const } : model;

  return StagehandInitParamsSchema.parse({
    protocolVersion: STAGEHAND_PROTOCOL_VERSION,
    clientInfo: STAGEHAND_SDK_CLIENT_INFO,
    browserCdpUrl: browser.cdpClient.webSocketDebuggerUrl,
    logLevel: logging.level,
    ...protocolParams,
    ...browser.workerInitMetadata,
    ...(protocolModel === undefined ? {} : { model: protocolModel }),
  });
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
