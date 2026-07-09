import type { Protocol } from "devtools-protocol";
import type { Page } from "./page.js";

type RemoteObject = Protocol.Runtime.RemoteObject;

export type ConsoleListener = (message: ConsoleMessage) => void;

function formatRemoteObject(obj: RemoteObject | undefined): string {
  if (!obj) return "";

  if ("value" in obj) {
    const value = obj.value;
    if (value === undefined) return "";
    if (typeof value === "string") return value;
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  if (obj.unserializableValue) return obj.unserializableValue;
  if (obj.description) return obj.description;

  return obj.type ?? "";
}

export class ConsoleMessage {
  constructor(
    private readonly event: Protocol.Runtime.ConsoleAPICalledEvent,
    private readonly pageRef?: Page,
  ) {}

  type(): Protocol.Runtime.ConsoleAPICalledEvent["type"] {
    return this.event.type;
  }

  text(): string {
    const args = this.args();
    if (!args.length) return "";
    return args
      .map((arg) => formatRemoteObject(arg))
      .filter((chunk) => chunk.length > 0)
      .join(" ");
  }

  args(): RemoteObject[] {
    return this.event.args ? [...this.event.args] : [];
  }

  location(): { url?: string; lineNumber?: number; columnNumber?: number } {
    const frame = this.event.stackTrace?.callFrames?.[0];
    return {
      url: frame?.url,
      lineNumber: frame?.lineNumber,
      columnNumber: frame?.columnNumber,
    };
  }

  page(): Page | undefined {
    return this.pageRef;
  }

  timestamp(): number | undefined {
    return this.event.timestamp;
  }

  raw(): Protocol.Runtime.ConsoleAPICalledEvent {
    return this.event;
  }

  toString(): string {
    return this.text();
  }
}
