import { createReadStream } from "node:fs";
export type BrowserbaseExtensionArchive = {
    path: string;
    cleanup(): Promise<void>;
};
export type BrowserbaseExtensionClient = {
    uploadExtension(archivePath: string): Promise<{
        id: string;
    }>;
    deleteExtension(extensionId: string): Promise<void>;
};
export type ProvisionedBrowserbaseExtension = {
    extensionId: string;
    cleanup(): Promise<void>;
};
export type BrowserbaseExtensionSdk = {
    extensions: {
        create(params: {
            file: ReturnType<typeof createReadStream>;
        }): Promise<{
            id: string;
        }>;
        delete(extensionId: string, options?: {
            headers?: Record<string, string | null>;
        }): Promise<void>;
    };
};
type BrowserbaseSdkFactory = (apiKey: string) => BrowserbaseExtensionSdk;
export declare function createBrowserbaseExtensionArchive(extensionDir?: string): Promise<BrowserbaseExtensionArchive>;
export declare function createBrowserbaseExtensionClient(apiKey: string, createSdk?: BrowserbaseSdkFactory): BrowserbaseExtensionClient;
export declare function provisionBrowserbaseExtension(client: BrowserbaseExtensionClient, extensionDir?: string): Promise<ProvisionedBrowserbaseExtension>;
export {};
