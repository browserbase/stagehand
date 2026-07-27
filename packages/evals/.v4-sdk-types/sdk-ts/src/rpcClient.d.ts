import { type Context } from "@opentelemetry/api";
import { type RPCMethod } from "../../protocol/json-rpc/schemas.js";
import type { JSONRPCMessage, JSONRPCRequest, JSONRPCResponse } from "../../protocol/json-rpc/types.js";
import type { StagehandRpcNotification } from "../../protocol/types.js";
import { z } from "zod/v4";
import { type ServiceWorkerInfo } from "./cdpClient.js";
type PendingRequest = {
    method: RPCMethod;
    resolve(value: unknown): void;
    reject(error: Error): void;
    timeout: ReturnType<typeof setTimeout>;
};
type RegisteredRequestHandler = {
    method: RPCMethod;
    handle(params: unknown): Promise<unknown>;
};
export declare const RPCClientOptionsSchema: z.ZodUnion<readonly [z.ZodObject<{
    cdpUrl: z.ZodString;
    serviceWorkerUrlIncludes: z.ZodOptional<z.ZodString>;
    discoveryTimeoutMs: z.ZodOptional<z.ZodNumber>;
    commandTimeoutMs: z.ZodOptional<z.ZodNumber>;
    requestTimeoutMs: z.ZodOptional<z.ZodNumber>;
    cdpConnectTimeoutMs: z.ZodOptional<z.ZodNumber>;
    telemetry: z.ZodDefault<z.ZodObject<{
        traces: z.ZodObject<{
            endpoint: z.ZodURL;
            headers: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodString>>;
        }, z.core.$strict>;
    }, z.core.$strict>>;
    extensionDir: z.ZodString;
    extensionId: z.ZodOptional<z.ZodNever>;
    preloadedExtension: z.ZodOptional<z.ZodNever>;
}, z.core.$strict>, z.ZodObject<{
    cdpUrl: z.ZodString;
    serviceWorkerUrlIncludes: z.ZodOptional<z.ZodString>;
    discoveryTimeoutMs: z.ZodOptional<z.ZodNumber>;
    commandTimeoutMs: z.ZodOptional<z.ZodNumber>;
    requestTimeoutMs: z.ZodOptional<z.ZodNumber>;
    cdpConnectTimeoutMs: z.ZodOptional<z.ZodNumber>;
    telemetry: z.ZodDefault<z.ZodObject<{
        traces: z.ZodObject<{
            endpoint: z.ZodURL;
            headers: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodString>>;
        }, z.core.$strict>;
    }, z.core.$strict>>;
    extensionId: z.ZodString;
    extensionDir: z.ZodOptional<z.ZodNever>;
    preloadedExtension: z.ZodOptional<z.ZodNever>;
}, z.core.$strict>, z.ZodObject<{
    cdpUrl: z.ZodString;
    serviceWorkerUrlIncludes: z.ZodOptional<z.ZodString>;
    discoveryTimeoutMs: z.ZodOptional<z.ZodNumber>;
    commandTimeoutMs: z.ZodOptional<z.ZodNumber>;
    requestTimeoutMs: z.ZodOptional<z.ZodNumber>;
    cdpConnectTimeoutMs: z.ZodOptional<z.ZodNumber>;
    telemetry: z.ZodDefault<z.ZodObject<{
        traces: z.ZodObject<{
            endpoint: z.ZodURL;
            headers: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodString>>;
        }, z.core.$strict>;
    }, z.core.$strict>>;
    preloadedExtension: z.ZodLiteral<true>;
    extensionDir: z.ZodOptional<z.ZodNever>;
    extensionId: z.ZodOptional<z.ZodNever>;
}, z.core.$strict>]>;
export type RPCClientOptions = z.input<typeof RPCClientOptionsSchema>;
export type CDPTransport = {
    readonly serviceWorker: ServiceWorkerInfo;
    onmessage?: (message: unknown) => void | Promise<void>;
    onclose?: (reason?: Error) => void;
    onerror?: (error: Error) => void;
    send(message: JSONRPCMessage): Promise<void>;
    close(): void;
};
export declare class RPCClient {
    readonly serviceWorker: ServiceWorkerInfo;
    nextRequestId: number;
    pending: Map<number, PendingRequest>;
    requestHandlers: Map<string, RegisteredRequestHandler>;
    notificationListeners: Set<(notification: StagehandRpcNotification) => void>;
    pendingNotifications: StagehandRpcNotification[];
    closed: boolean;
    readonly cdp: CDPTransport;
    readonly requestTimeoutMs: number;
    constructor(cdp: CDPTransport, requestTimeoutMs: number);
    send<Method extends RPCMethod>(method: Method, params: z.input<Method["params"]>): Promise<z.output<Method["result"]>>;
    onRequest<Method extends RPCMethod>(method: Method, handler: (params: z.output<Method["params"]>) => z.input<Method["result"]> | Promise<z.input<Method["result"]>>): () => void;
    onNotification(listener: (notification: StagehandRpcNotification) => void): () => void;
    close(reason?: Error): void;
    waitForResponse(id: number, method: RPCMethod): Promise<unknown>;
    receive(raw: unknown): Promise<void>;
    handleRequest(request: JSONRPCRequest): Promise<void>;
    receiveResponse(response: JSONRPCResponse): void;
    rejectPending(id: number, error: Error): void;
    sendError(id: number | null, code: number, message: string, data?: unknown): Promise<void>;
    handleNotification(notification: StagehandRpcNotification): void;
}
export declare function connectRPCClient(input: RPCClientOptions): Promise<RPCClient>;
export declare function getTraceContextFields(requestContext: Context): {
    traceparent?: string;
    tracestate?: string;
};
export {};
