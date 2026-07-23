import Browserbase from "@browserbasehq/sdk";
import type { BrowserbaseSessionCreateParams } from "../../protocol/types.js";
import { type BrowserbaseExtensionClient, type BrowserbaseExtensionSdk, type ProvisionedBrowserbaseExtension } from "./browserbaseExtension.js";
export type BrowserbaseSessionClient = {
    createSession(params: BrowserbaseSessionCreateParams): Promise<{
        sessionId: string;
        cdpUrl: string;
        close?: () => Promise<void> | void;
    }>;
};
export type BrowserbaseSessionClientFactory = (apiKey: string) => BrowserbaseSessionClient;
export type BrowserbaseApiClient = BrowserbaseExtensionClient & {
    createSession(params: BrowserbaseSessionCreateParams): Promise<{
        id: string;
        connectUrl: string;
    }>;
    releaseSession(sessionId: string): Promise<void>;
};
type BrowserbaseSessionClientDependencies = {
    browserbase?: BrowserbaseApiClient;
    provisionExtension?: (client: BrowserbaseExtensionClient) => Promise<ProvisionedBrowserbaseExtension>;
};
type BrowserbaseSdk = BrowserbaseExtensionSdk & {
    sessions: {
        create(params: Browserbase.SessionCreateParams): Promise<{
            id: string;
            connectUrl: string;
        }>;
        update(sessionId: string, params: {
            status: "REQUEST_RELEASE";
        }): Promise<unknown>;
    };
};
type BrowserbaseSdkFactory = (apiKey: string) => BrowserbaseSdk;
export declare function createBrowserbaseSessionClient(apiKey: string, dependencies?: BrowserbaseSessionClientDependencies): BrowserbaseSessionClient;
export declare function createBrowserbaseApiClient(apiKey: string, createSdk?: BrowserbaseSdkFactory): BrowserbaseApiClient;
export {};
