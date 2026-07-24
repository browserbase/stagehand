import type { ContextClipboardPasteParams } from "../../protocol/types.js";
import type { Page } from "./page.js";
import type { RPCClient } from "./rpcClient.js";
export type ClipboardOptions = {
    page?: Page;
};
export type ClipboardPasteOptions = ClipboardOptions & {
    shortcut?: ContextClipboardPasteParams["shortcut"];
};
export declare class BrowserClipboard {
    readonly rpcClient: RPCClient;
    constructor(rpcClient: RPCClient);
    readText(options?: ClipboardOptions): Promise<string>;
    writeText(text: string, options?: ClipboardOptions): Promise<void>;
    clear(options?: ClipboardOptions): Promise<void>;
    paste(options?: ClipboardPasteOptions): Promise<void>;
    copy(options?: ClipboardOptions): Promise<void>;
    cut(options?: ClipboardOptions): Promise<void>;
}
