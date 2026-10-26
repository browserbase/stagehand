import { z } from "zod/v4";
import { JSONRPCMessageSchema } from "@browserbasehq/stagehand-protocol/json-rpc/schemas";
import type { JSONRPCMessage } from "@browserbasehq/stagehand-protocol/json-rpc/types";

const ChromeBindingMessageSchema = z.string();
const ChromeBindingSchema = z.custom<(message: string) => void>(
  (value) => typeof value === "function",
  "Chrome runtime binding is not installed",
);

/** JSON-RPC transport backed by Chrome's Runtime binding mechanism. */
export class ChromeRuntimeClient {
  onmessage?: (
    message: unknown,
    runtimeAttachments?: { callback?: unknown },
  ) => void | Promise<void>;
  onclose?: (reason?: Error) => void;
  onerror?: (error: Error) => void;
  closed = false;

  constructor(
    readonly scope: object,
    readonly bindingName: string,
  ) {}

  async send(message: JSONRPCMessage): Promise<void> {
    if (this.closed) throw new Error("Chrome runtime client is closed");

    const binding = ChromeBindingSchema.parse(Reflect.get(this.scope, this.bindingName));
    binding(JSON.stringify(JSONRPCMessageSchema.parse(message)));
  }

  async receive(raw: unknown, runtimeAttachments?: { callback?: unknown }): Promise<void> {
    if (this.closed) return;
    const message = ChromeBindingMessageSchema.parse(raw);
    await this.onmessage?.(message, runtimeAttachments);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.onmessage = undefined;
    this.onclose = undefined;
    this.onerror = undefined;
  }
}
