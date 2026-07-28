import { type RPCClient, type RPCClientOptions } from "./rpcClient.js";
import type { ActResultData, Action, BrowserGetVersionResult, RuntimeLoopbackStatusResult, StagehandMetrics, StagehandPingResult } from "../../protocol/types.js";
import { z } from "zod/v4";
import { BrowserContext } from "./browserContext.js";
import { type ResolvedBrowserSource } from "./browserSource.js";
import { type StagehandClientActOptions, type StagehandClientExtractOptions, type StagehandClientInitParams, type StagehandClientObserveOptions } from "./clientSchemas.js";
type StagehandAdapters = {
    resolveBrowserSource?: (initParams: StagehandClientInitParams) => Promise<ResolvedBrowserSource>;
    connectRpcClient?: (options: RPCClientOptions) => Promise<RPCClient>;
};
export declare class Stagehand {
    readonly initParams: StagehandClientInitParams;
    browserContext: BrowserContext | undefined;
    isInitialized: boolean;
    rpcClient: RPCClient | undefined;
    removeNotificationListener: (() => void) | undefined;
    removeClientLLMHandler: (() => void) | undefined;
    browser: ResolvedBrowserSource | undefined;
    closePromise: Promise<void> | undefined;
    constructor(initParams: StagehandClientInitParams);
    get context(): BrowserContext;
    get initialized(): boolean;
    ping(): Promise<StagehandPingResult>;
    runtimeLoopbackStatus(): Promise<RuntimeLoopbackStatusResult>;
    browserGetVersion(): Promise<BrowserGetVersionResult>;
    metrics(): Promise<StagehandMetrics>;
    init(): Promise<void>;
    act(input: string, options?: StagehandClientActOptions): Promise<ActResultData>;
    observe(instruction?: string, options?: StagehandClientObserveOptions): Promise<Action[]>;
    extract<Schema extends z.ZodType>(instruction: string, schema: Schema, options?: StagehandClientExtractOptions): Promise<z.output<Schema>>;
    close(): Promise<void>;
    private get connectedRpcClient();
    private closeBrowserSource;
}
export declare function createStagehandWithClientForTest(client: RPCClient): Stagehand;
export declare function createStagehandWithDependenciesForTest(initParams: StagehandClientInitParams, adapters: StagehandAdapters): Stagehand;
export {};
