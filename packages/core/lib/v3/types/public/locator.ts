import { Buffer } from "buffer";

export interface SetInputFilePayload {
  name: string;
  mimeType?: string;
  buffer: ArrayBuffer | Uint8Array | Buffer | string;
  lastModified?: number;
}

export type SetInputFilesArgument =
  | string
  | string[]
  | SetInputFilePayload
  | SetInputFilePayload[];

export interface NormalizedFilePayload {
  name: string;
  mimeType: string;
  buffer: Buffer;
  lastModified: number;
  /** Absolute path to the source file when provided by the caller. */
  absolutePath?: string;
}
