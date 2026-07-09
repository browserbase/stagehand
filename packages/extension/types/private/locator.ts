import { Buffer } from "buffer";

export interface NormalizedFilePayload {
  name: string;
  mimeType: string;
  buffer: Buffer;
  lastModified: number;
  /** Absolute path to the source file when provided by the caller. */
  absolutePath?: string;
}
