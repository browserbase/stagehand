import type { Page } from "../../understudy/page.js";

export interface ClipboardOptions {
  page?: Page;
}

export interface ClipboardPasteOptions extends ClipboardOptions {
  shortcut?: "ControlOrMeta+V" | "Meta+V" | "Control+V";
}

export interface BrowserClipboard {
  readText(options?: ClipboardOptions): Promise<string>;
  writeText(text: string, options?: ClipboardOptions): Promise<void>;
  clear(options?: ClipboardOptions): Promise<void>;
  paste(options?: ClipboardPasteOptions): Promise<void>;
  copy(options?: ClipboardOptions): Promise<void>;
  cut(options?: ClipboardOptions): Promise<void>;
}
