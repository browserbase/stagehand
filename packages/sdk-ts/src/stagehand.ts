import { RPCClient } from "./rpcClient.js";
import {
  DefaultExtractDataSchema,
  STAGEHAND_PROTOCOL_VERSION,
  StagehandInitParamsSchema,
} from "../../protocol/schemas.js";
import { JSONRPCErrorObjectSchema } from "../../protocol/json-rpc/schemas.js";
import { StagehandMethods } from "../../protocol/schema-registry.js";
import type {
  Action,
  ActResult,
  DefaultExtractData,
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
import { attachStagehandBrowserContext, detachStagehandBrowserContext } from "./browser/index.js";
import { withStagehandInitDeadline } from "./timeouts.js";

type ProtocolExtractResult = import("../../protocol/types.js").ExtractResult;

export type ExtractResult<Schema extends z.ZodType> = Omit<ProtocolExtractResult, "data"> & {
  data: z.output<Schema>;
};

const isZodSchema = (value: unknown): value is z.ZodType =>
  typeof value === "object" &&
  value !== null &&
  "parse" in value &&
  typeof value.parse === "function" &&
  "safeParse" in value &&
  typeof value.safeParse === "function";

export class Stagehand {
  isInitialized = false;
  rpcClient: RPCClient | undefined;
  removeNotificationListener: (() => void) | undefined;
  removeClientLLMHandler: (() => void) | undefined;
  closePromise: Promise<void> | undefined;
  initRequestStarted = false;

  private constructor(
    private readonly browserHandle: StagehandBrowser,
    private readonly createConfig: ResolvedStagehandClientCreateConfig,
  ) {}

  static async create(input: StagehandCreateOptions): Promise<Stagehand> {
    const { browser, ...createConfig } = StagehandCreateOptionsSchema.parse(input);
    const claimedBrowser = claimStagehandBrowser(browser);
    const stagehand = new Stagehand(browser, createConfig);
    let lifecycleSignal: AbortSignal | undefined;
    try {
      await withStagehandInitDeadline((signal) => {
        lifecycleSignal = signal;
        return stagehand.initialize(claimedBrowser, signal);
      });
      return stagehand;
    } catch (error) {
      const initFailureIsAmbiguous =
        lifecycleSignal?.aborted ||
        (stagehand.initRequestStarted && !isDefinitiveRPCErrorResponse(error));
      if (initFailureIsAmbiguous) {
        try {
          await browser.close();
        } catch (cleanupError) {
          throw new AggregateError(
            [error, cleanupError],
            "Stagehand initialization failed ambiguously and browser invalidation also failed",
            { cause: error },
          );
        }
      } else {
        releaseStagehandBrowser(browser);
      }
      throw error;
    }
  }

  get context(): BrowserContext {
    return this.browserHandle.context;
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

  private async initialize(browser: ClaimedStagehandBrowser, signal: AbortSignal): Promise<void> {
    const createConfig = this.createConfig;
    const rpcClient = new RPCClient(browser.cdpClient);
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

      this.initRequestStarted = true;
      await rpcClient.sendStagehandInit(
        stagehandCreateParamsForWorker(createConfig, browser),
        signal,
      );
      attachStagehandBrowserContext(this.browserHandle, new BrowserContext(rpcClient));
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
    const targetPage = page ?? (await this.browser.context.activePage());
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
    const targetPage = page ?? (await this.browser.context.activePage());
    if (!targetPage) throw new Error("Stagehand has no active page.");
    const response = await this.connectedRpcClient.send(StagehandMethods.stagehandObserve, {
      pageId: targetPage.pageId,
      ...(instruction === undefined ? {} : { instruction }),
      ...(options === undefined ? {} : { options: protocolOptions }),
    });

    return response;
  }

  async extract(
    instruction: string,
    options?: StagehandClientExtractOptions,
  ): Promise<ExtractResult<z.ZodType<DefaultExtractData>>>;
  async extract<Schema extends z.ZodType>(
    instruction: string,
    schema: Schema,
    options?: StagehandClientExtractOptions,
  ): Promise<ExtractResult<Schema>>;
  async extract<Schema extends z.ZodType | StagehandClientExtractOptions>(
    instruction: string,
    schema?: Schema,
    options?: StagehandClientExtractOptions,
  ): Promise<ExtractResult<z.ZodType>> {
    const hasCustomSchema = isZodSchema(schema);
    const resolvedSchema = hasCustomSchema ? schema : DefaultExtractDataSchema;
    const resolvedOptions = hasCustomSchema ? options : schema;
    const { page, ...protocolOptions } = StagehandClientExtractOptionsSchema.parse(
      resolvedOptions ?? {},
    );
    const targetPage = page ?? (await this.browser.context.activePage());
    if (!targetPage) throw new Error("Stagehand has no active page.");
    const response = await this.connectedRpcClient.send(StagehandMethods.stagehandExtract, {
      pageId: targetPage.pageId,
      instruction,
      ...(hasCustomSchema ? { schema: z.json().parse(z.toJSONSchema(resolvedSchema)) } : {}),
      ...(resolvedOptions === undefined ? {} : { options: protocolOptions }),
    });

    return {
      ...response,
      data: resolvedSchema.parse(response.data),
    };
  }

  close(): Promise<void> {
    this.closePromise ??= (async () => {
      try {
        if (this.isInitialized) {
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
        detachStagehandBrowserContext(this.browserHandle);
        this.isInitialized = false;
      }
    })();
    return this.closePromise;
  }

  private get connectedRpcClient(): RPCClient {
    if (!this.isInitialized || !this.rpcClient) {
      throw new Error(
        "Stagehand is unavailable. Create a new instance with await Stagehand.create().",
      );
    }
    return this.rpcClient;
  }
}

function isDefinitiveRPCErrorResponse(error: unknown): boolean {
  return error instanceof Error && JSONRPCErrorObjectSchema.safeParse(error.cause).success;
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
    if (result && typeof result === "object" && "then" in result) {
      void Promise.resolve(result).catch(reportOnLogError);
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
