export interface NormalizedFilePayload {
  name: string;
  mimeType: string;
  bytes: Uint8Array;
  lastModified: number;
}
