import type { z } from "zod/v4";
import { ClipboardOptionsSchema, ClipboardPasteOptionsSchema } from "./schemas.js";

export type ClipboardOptions = z.infer<typeof ClipboardOptionsSchema>;
export type ClipboardPasteOptions = z.infer<typeof ClipboardPasteOptionsSchema>;

export interface BrowserClipboard {
  readText(options?: ClipboardOptions): Promise<string>;
  writeText(text: string, options?: ClipboardOptions): Promise<void>;
  clear(options?: ClipboardOptions): Promise<void>;
  paste(options?: ClipboardPasteOptions): Promise<void>;
  copy(options?: ClipboardOptions): Promise<void>;
  cut(options?: ClipboardOptions): Promise<void>;
}
