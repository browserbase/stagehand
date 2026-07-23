import type { JSONRPCMessage } from "../../protocol/json-rpc/types.js";
import { z } from "zod/v4";
type JsonObject = Record<string, unknown>;
type TargetInfo = {
    targetId: string;
    type: string;
    title: string;
    url: string;
};
export type ServiceWorkerInfo = {
    targetId: string;
    url: string;
    title: string;
    extensionId?: string;
};
export type CDPClientOptions = {
    cdpUrl: string;
    extensionDir?: string;
    extensionId?: string;
    preloadedExtension?: true;
    serviceWorkerUrlIncludes?: string;
    discoveryTimeoutMs: number;
    commandTimeoutMs: number;
    cdpConnectTimeoutMs: number;
};
type PendingCDPRequest = {
    method: string;
    resolve: (value: unknown) => void;
    reject: (reason: Error) => void;
    timeoutId: ReturnType<typeof setTimeout>;
};
type VersionResponse = {
    ok: boolean;
    status: number;
    statusText: string;
    json(): Promise<unknown>;
};
type ResolveBrowserWebSocketUrlOptions = {
    timeout?: number;
    pollIntervalMs?: number;
    fetchFn?: (url: string) => Promise<VersionResponse>;
    delayFn?: (ms: number) => Promise<void>;
    nowFn?: () => number;
};
declare const CDPResponseEnvelopeSchema: z.ZodObject<{
    id: z.ZodInt;
    result: z.ZodOptional<z.ZodUnknown>;
    error: z.ZodOptional<z.ZodObject<{
        code: z.ZodInt;
        message: z.ZodString;
        data: z.ZodOptional<z.ZodUnknown>;
    }, z.core.$loose>>;
    sessionId: z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare class CDPConnectionClosedError extends Error {
    constructor();
}
export declare class CDPClient {
    readonly socket: WebSocket;
    readonly commandTimeoutMs: number;
    onmessage?: (message: unknown) => void | Promise<void>;
    onclose?: (reason?: Error) => void;
    onerror?: (error: Error) => void;
    readonly webSocketDebuggerUrl: string;
    nextId: number;
    pending: Map<number, PendingCDPRequest>;
    sessionId: string | undefined;
    attachedServiceWorker: ServiceWorkerInfo | undefined;
    closed: boolean;
    constructor(socket: WebSocket, webSocketDebuggerUrl: string, commandTimeoutMs: number);
    static connect(options: CDPClientOptions): Promise<CDPClient>;
    get serviceWorker(): ServiceWorkerInfo;
    send(message: JSONRPCMessage): Promise<void>;
    sendCommand<Result = JsonObject>(method: string, params?: JsonObject, sessionId?: string, timeout?: number): Promise<Result>;
    close(): void;
    handleMessage(data: unknown): Promise<void>;
    handleResponse(message: z.output<typeof CDPResponseEnvelopeSchema>): void;
    rejectPending(error: Error): void;
}
type CDPCommandSender = Pick<CDPClient, "sendCommand">;
export declare function waitForRuntimeReady(cdp: CDPCommandSender, sessionId: string, options: {
    timeout: number;
    pollIntervalMs?: number;
    delayFn?: (ms: number) => Promise<void>;
    nowFn?: () => number;
}): Promise<void>;
export declare function waitForPreloadedStagehandServiceWorker(cdp: CDPCommandSender, options: {
    urlIncludes?: string;
    timeout: number;
    pollIntervalMs?: number;
    delayFn?: (ms: number) => Promise<void>;
    nowFn?: () => number;
}): Promise<{
    serviceWorker: TargetInfo;
    sessionId: string;
}>;
export declare function waitForServiceWorker(cdp: CDPCommandSender, options: {
    extensionId?: string;
    urlIncludes?: string;
    timeout: number;
    activationDelayMs?: number;
    pollIntervalMs?: number;
    delayFn?: (ms: number) => Promise<void>;
}): Promise<TargetInfo>;
export declare function loadUnpackedExtension(cdp: CDPCommandSender, extensionDir: string): Promise<string>;
export declare function resolveBrowserWebSocketUrl(cdpUrl: string, options?: ResolveBrowserWebSocketUrlOptions): Promise<string>;
export {};
