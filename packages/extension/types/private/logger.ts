import type { LogLine } from "../../../protocol/types.js";

export type Logger = (line: LogLine) => void;

// Compile-only shim for V3 cache internals until structured logging replaces callbacks.
export const noopLogger: Logger = () => {};
