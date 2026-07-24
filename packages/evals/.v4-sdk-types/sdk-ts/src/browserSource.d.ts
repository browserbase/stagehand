import { type BrowserSource } from "./clientSchemas.js";
import { type BrowserbaseSessionClient, type BrowserbaseSessionClientFactory } from "./browserbaseSession.js";
export type { BrowserbaseSessionClient, BrowserbaseSessionClientFactory };
type LocalBrowserSource = Extract<BrowserSource, {
    type: "local";
}>;
type LocalBrowserLaunchOptions = Omit<LocalBrowserSource, "type">;
export type ResolvedBrowserSource = {
    cdpUrl: string;
    cdpHeaders?: Record<string, string>;
    browserbaseSessionId?: string;
    preloadedExtension?: boolean;
    keepAlive: boolean;
    close?: () => Promise<void> | void;
};
export type LocalBrowserLauncher = (options: LocalBrowserLaunchOptions) => Promise<{
    cdpUrl: string;
    close: () => Promise<void> | void;
}>;
export type BrowserSourceResolverDependencies = {
    launchLocalBrowser?: LocalBrowserLauncher;
    browserbase?: BrowserbaseSessionClient;
    createBrowserbaseSessionClient?: BrowserbaseSessionClientFactory;
};
export declare function resolveBrowserSource(input: unknown, dependencies?: BrowserSourceResolverDependencies): Promise<ResolvedBrowserSource>;
