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
