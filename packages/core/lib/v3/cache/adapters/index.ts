// Storage adapter interface
export type { StorageAdapter } from "./types";

// Built-in adapters
export { FilesystemAdapter } from "./FilesystemAdapter";
export { NullAdapter } from "./NullAdapter";
export { InMemoryAdapter } from "./InMemoryAdapter";
export { GCSAdapter, type GCSAdapterOptions } from "./GCSAdapter";
