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
import { resolveBrowserSource, type ResolvedBrowserSource } from "./browserSource.js";
import {
  StagehandClientActOptionsSchema,
  StagehandClientExtractOptionsSchema,
  StagehandClientInitParamsSchema,
  StagehandClientObserveOptionsSchema,
  type StagehandClientActOptions,
  type StagehandClientExtractOptions,
  type ResolvedStagehandClientInitParams,
  type StagehandClientInitParams,
  type StagehandClientObserveOptions,
} from "./clientSchemas.js";
import { CDPConnectionClosedError } from "./cdpClient.js";

type StagehandAdapters = {
  resolveBrowserSource?: (initParams: StagehandClientInitParams) => Promise<ResolvedBrowserSource>;
  connectRpcClient?: (options: RPCClientOptions) => Promise<RPCClient>;
};

const stagehandAdapters = new WeakMap<Stagehand, StagehandAdapters>();

export class Stagehand {
  browserContext: BrowserContext | undefined;
  isInitialized = false;
  rpcClient: RPCClient | undefined;
  removeNotificationListener: (() => void) | undefined;
  removeClientLLMHandler: (() => void) | undefined;
  browser: ResolvedBrowserSource | undefined;
  closePromise: Promise<void> | undefined;

  constructor(readonly initParams: StagehandClientInitParams) {}

  get context(): BrowserContext {
    if (!this.browserContext) {
      throw new Error("Stagehand is not initialized. Call stagehand.init() before using context.");
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

  async init(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    const clientInitParams = StagehandClientInitParamsSchema.parse(this.initParams);
    const adapters = stagehandAdapters.get(this) ?? {};
    const browser = await (adapters.resolveBrowserSource ?? resolveBrowserSource)(clientInitParams);
    this.browser = browser;

    try {
      const rpcClient = await (adapters.connectRpcClient ?? connectRPCClient)({
        cdpUrl: browser.cdpUrl,
        // TODO: Thread browser.cdpHeaders through CDP discovery and the WebSocket handshake.
        ...(browser.preloadedExtension
          ? { preloadedExtension: true as const }
          : { extensionDir: new URL("../../extension/dist", import.meta.url).pathname }),
        serviceWorkerUrlIncludes: "service-worker.js",
        telemetry: clientInitParams.telemetry,
      });
      this.rpcClient = rpcClient;
      this.removeNotificationListener = rpcClient.onNotification(renderStagehandNotification);
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
    const browser = this.browser;
    this.browser = undefined;
    if (!browser || browser.keepAlive) {
      return;
    }
    await browser.close?.();
  }
}

function stagehandInitParamsForWorker(
  initParams: ResolvedStagehandClientInitParams,
  resolvedBrowser: ResolvedBrowserSource,
) {
  const { browser, model, ...protocolParams } = initParams;
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

export function createStagehandWithClientForTest(client: RPCClient): Stagehand {
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

function renderStagehandNotification(notification: StagehandRpcNotification): void {
  const { level, message, data } = notification.params;

  switch (level) {
    case "debug":
      // oxlint-disable-next-line no-console -- This is the SDK's intentional terminal log sink.
      console.debug(message, data);
      break;
    case "info":
      // oxlint-disable-next-line no-console -- This is the SDK's intentional terminal log sink.
      console.info(message, data);
      break;
    case "warn":
      // oxlint-disable-next-line no-console -- This is the SDK's intentional terminal log sink.
      console.warn(message, data);
      break;
    case "error":
      // oxlint-disable-next-line no-console -- This is the SDK's intentional terminal log sink.
      console.error(message, data);
      break;
  }
}

export function createStagehandWithDependenciesForTest(
  initParams: StagehandClientInitParams,
  adapters: StagehandAdapters,
): Stagehand {
  const stagehand = new Stagehand(initParams);
  stagehandAdapters.set(stagehand, adapters);
  return stagehand;
}
