import { z } from "zod/v4";
import { JSONRPCMessageSchema } from "../../protocol/json-rpc/schemas.js";
import type { JSONRPCMessage } from "../../protocol/json-rpc/types.js";

const ChromeBindingMessageSchema = z.string();
const ChromeBindingSchema = z.custom<(message: string) => void>(
  (value) => typeof value === "function",
  "Chrome runtime binding is not installed",
);

/** JSON-RPC transport backed by Chrome's Runtime binding mechanism. */
export class ChromeRuntimeClient {
  onmessage?: (message: unknown) => void | Promise<void>;
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

  async receive(raw: unknown): Promise<void> {
    if (this.closed) return;
    const message = ChromeBindingMessageSchema.parse(raw);
    await this.onmessage?.(message);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.onmessage = undefined;
    this.onclose = undefined;
    this.onerror = undefined;
  }
}
