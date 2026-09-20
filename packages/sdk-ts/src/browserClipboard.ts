import type { ContextClipboardPasteParams } from "@browserbasehq/stagehand-protocol/types";
import { StagehandMethods } from "@browserbasehq/stagehand-protocol/schema-registry";
import type { Page } from "./page.js";
import type { StagehandCommandClient } from "./commandClient.js";

export type ClipboardOptions = {
  page?: Page;
};

export type ClipboardPasteOptions = ClipboardOptions & {
  shortcut?: ContextClipboardPasteParams["shortcut"];
};

export class BrowserClipboard {
  constructor(readonly rpcClient: StagehandCommandClient) {}

  async readText(options?: ClipboardOptions): Promise<string> {
    return await this.rpcClient.send(
      StagehandMethods.contextClipboardReadText,
      clipboardTarget(options),
    );
  }

  async writeText(text: string, options?: ClipboardOptions): Promise<void> {
    await this.rpcClient.send(StagehandMethods.contextClipboardWriteText, {
      text,
      ...clipboardTarget(options),
    });
  }

  async clear(options?: ClipboardOptions): Promise<void> {
    await this.rpcClient.send(StagehandMethods.contextClipboardClear, clipboardTarget(options));
  }

  async paste(options?: ClipboardPasteOptions): Promise<void> {
    await this.rpcClient.send(StagehandMethods.contextClipboardPaste, {
      ...clipboardTarget(options),
      ...(options?.shortcut === undefined ? {} : { shortcut: options.shortcut }),
    });
  }

  async copy(options?: ClipboardOptions): Promise<void> {
    await this.rpcClient.send(StagehandMethods.contextClipboardCopy, clipboardTarget(options));
  }

  async cut(options?: ClipboardOptions): Promise<void> {
    await this.rpcClient.send(StagehandMethods.contextClipboardCut, clipboardTarget(options));
  }
}

function clipboardTarget(options?: ClipboardOptions): { pageId?: string } {
  return options?.page ? { pageId: options.page.pageId } : {};
}
