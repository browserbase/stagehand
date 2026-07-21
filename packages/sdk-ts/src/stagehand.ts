import { connectRPCClient, type RPCClient, type RPCClientOptions } from "./rpcClient.js";
import { StagehandInitParamsSchema } from "../../protocol/schemas.js";
import { StagehandMethods } from "../../protocol/schema-registry.js";
import type { StagehandRpcNotification } from "../../protocol/types.js";
import { BrowserContext } from "./browserContext.js";
import { resolveBrowserSource, type ResolvedBrowserSource } from "./browserSource.js";
import {
  StagehandClientInitParamsSchema,
  type ResolvedStagehandClientInitParams,
  type StagehandClientInitParams,
} from "./clientSchemas.js";

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
          : { extensionDir: new URL("../../server/dist", import.meta.url).pathname }),
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
  }

  async close(): Promise<void> {
    const context = this.browserContext;
    try {
      if (context) {
        await this.rpcClient?.send(StagehandMethods.stagehandClose, {});
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
  }

  async closeBrowserSource(): Promise<void> {
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
