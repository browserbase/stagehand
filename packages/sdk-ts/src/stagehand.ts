import { connectRPCClient, type RPCClient, type RPCClientOptions } from "./rpcClient.js";
import { StagehandOptionsSchema } from "../../protocol/pending-schemas.js";
import { StagehandMethods } from "../../protocol/schema-registry.js";
import type { StagehandOptions, StagehandRpcNotification } from "../../protocol/types.js";
import { BrowserContext } from "./browserContext.js";
import { resolveBrowserSource, type ResolvedBrowserSource } from "./browserSource.js";

type StagehandAdapters = {
  resolveBrowserSource?: (options: StagehandOptions) => Promise<ResolvedBrowserSource>;
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

  constructor(readonly options: StagehandOptions) {}

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

    const parsedOptions = StagehandOptionsSchema.parse(this.options);
    const adapters = stagehandAdapters.get(this) ?? {};
    const browser = await (adapters.resolveBrowserSource ?? resolveBrowserSource)(parsedOptions);
    this.browser = browser;

    try {
      const rpcClient = await (adapters.connectRpcClient ?? connectRPCClient)({
        cdpUrl: browser.cdpUrl,
        // TODO: Move extension provisioning into browser-source initialization.
        extensionDir: new URL("../../server/dist", import.meta.url).pathname,
        serviceWorkerUrlIncludes: "service-worker.js",
        telemetry: parsedOptions.telemetry,
      });
      this.rpcClient = rpcClient;
      this.removeNotificationListener = rpcClient.onNotification(renderStagehandNotification);
      if (parsedOptions.model) {
        const model =
          "generate" in parsedOptions.model
            ? {
                source: "client" as const,
                modelName: parsedOptions.model.modelName,
              }
            : parsedOptions.model;

        if ("generate" in parsedOptions.model) {
          this.removeClientLLMHandler = rpcClient.onRequest(
            StagehandMethods.llmGenerate,
            parsedOptions.model.generate,
          );
        }

        await rpcClient.send(StagehandMethods.stagehandInit, {
          cdpUrl: browser.cdpUrl,
          model,
        });
      }
      this.browserContext = new BrowserContext(rpcClient);
    } catch (error) {
      this.removeClientLLMHandler?.();
      this.removeClientLLMHandler = undefined;
      this.removeNotificationListener?.();
      this.removeNotificationListener = undefined;
      this.rpcClient?.close();
      this.rpcClient = undefined;
      await this.closeBrowserSource();
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

export function createStagehandWithClientForTest(client: RPCClient): Stagehand {
  return createStagehandWithDependenciesForTest(
    {
      localBrowserConnectOptions: {
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
  options: StagehandOptions,
  adapters: StagehandAdapters,
): Stagehand {
  const stagehand = new Stagehand(options);
  stagehandAdapters.set(stagehand, adapters);
  return stagehand;
}
