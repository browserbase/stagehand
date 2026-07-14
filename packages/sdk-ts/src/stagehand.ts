import { stagehandExtensionDistDir } from "../../extension/build.js";
import {
  connectStagehandBridge,
  type StagehandBridge,
  type StagehandBridgeOptions,
} from "../../modcdp/index.js";
import { StagehandOptionsSchema } from "../../protocol/pending-schemas.js";
import type { StagehandOptions } from "../../protocol/types.js";
import { BrowserContext } from "./browserContext.js";
import { resolveBrowserSource, type ResolvedBrowserSource } from "./browserSource.js";
import { BridgeProtocolClient } from "./bridgeProtocolClient.js";
import {
  buildStagehandProtocolRequest,
  parseStagehandProtocolResponse,
  type StagehandProtocolClient,
} from "./protocolClient.js";

type StagehandRuntimeDependencies = {
  resolveBrowserSource?: (options: StagehandOptions) => Promise<ResolvedBrowserSource>;
  connectBridge?: (options: StagehandBridgeOptions) => Promise<StagehandBridge>;
};

const stagehandRuntimeDependencies = new WeakMap<Stagehand, StagehandRuntimeDependencies>();

export class Stagehand {
  #context: BrowserContext | undefined;
  #initialized = false;
  #bridge: StagehandBridge | undefined;
  #browser: ResolvedBrowserSource | undefined;

  constructor(private readonly options: StagehandOptions) {}

  get context(): BrowserContext {
    if (!this.#context) {
      throw new Error("Stagehand is not initialized. Call stagehand.init() before using context.");
    }
    return this.#context;
  }

  get initialized(): boolean {
    return this.#initialized;
  }

  async init(): Promise<void> {
    if (this.#initialized) {
      return;
    }

    const parsedOptions = StagehandOptionsSchema.parse(this.options);
    const dependencies = stagehandRuntimeDependencies.get(this) ?? {};
    const browser = await (dependencies.resolveBrowserSource ?? resolveBrowserSource)(
      parsedOptions,
    );
    this.#browser = browser;

    try {
      const bridge = await (dependencies.connectBridge ?? connectStagehandBridge)({
        cdpUrl: browser.cdpUrl,
        extensionDir: stagehandExtensionDistDir,
        serviceWorkerUrlIncludes: "service-worker.js",
        telemetry: parsedOptions.telemetry,
      });
      this.#bridge = bridge;
      this.#context = new BrowserContext(new BridgeProtocolClient(bridge));
    } catch (error) {
      await this.closeBrowserSource();
      throw error;
    }

    this.#initialized = true;
  }

  async close(): Promise<void> {
    const context = this.#context;
    try {
      if (context) {
        await this.#bridge?.send("stagehand.close", {});
      }
    } finally {
      this.#bridge?.close();
      await this.closeBrowserSource();
      this.#bridge = undefined;
      this.#context = undefined;
      this.#initialized = false;
    }
  }

  async closeBrowserSource(): Promise<void> {
    const browser = this.#browser;
    this.#browser = undefined;
    if (!browser || browser.keepAlive) {
      return;
    }
    await browser.close?.();
  }
}

export function createStagehandWithClientForTest(client: StagehandProtocolClient): Stagehand {
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
      connectBridge: async () => ({
        serviceWorker: {
          targetId: "test-worker",
          url: "chrome-extension://stagehand/service-worker.js",
          title: "Stagehand",
          extensionId: "stagehand",
        },
        send: async (method, params) => {
          const request = buildStagehandProtocolRequest(method, params);
          const response = await client.send(request);
          return parseStagehandProtocolResponse(method, response);
        },
        close: () => {},
      }),
    },
  );
}

export function createStagehandWithDependenciesForTest(
  options: StagehandOptions,
  dependencies: StagehandRuntimeDependencies,
): Stagehand {
  const stagehand = new Stagehand(options);
  stagehandRuntimeDependencies.set(stagehand, dependencies);
  return stagehand;
}
