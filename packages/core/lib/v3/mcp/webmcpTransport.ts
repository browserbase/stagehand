import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import type { CDPSessionLike } from "../understudy/cdp";

const MCP_CHANNEL = "mcp-default";
const MCP_TYPE = "mcp";
const BINDING_NAME = "__stagehand_webmcp_recv";

// Control signals matching the WebMCP/MCP-B Tab transport wire protocol
const SIGNAL_CHECK_READY = "mcp-check-ready";
const SIGNAL_SERVER_READY = "mcp-server-ready";

/**
 * In-page bridge script injected via Runtime.evaluate.
 *
 * It does two things:
 * 1. Listens for server→client postMessages and forwards them to Node
 *    via the Runtime.addBinding callback.
 * 2. Exposes a __stagehand_webmcp_send(json) function that Node calls
 *    to post client→server messages into the page.
 */
const BRIDGE_SCRIPT = `
(function() {
  if (window.__stagehand_webmcp_bridge) return;
  window.__stagehand_webmcp_bridge = true;

  // Forward server→client messages to the Node binding
  window.addEventListener("message", function(event) {
    if (event.source !== window) return;
    var d = event.data;
    if (!d || d.type !== "${MCP_TYPE}" || d.channel !== "${MCP_CHANNEL}") return;
    if (d.direction !== "server-to-client") return;
    try {
      ${BINDING_NAME}(typeof d.payload === "string" ? d.payload : JSON.stringify(d.payload));
    } catch(e) {
      console.warn("[stagehand-webmcp] Failed to forward message to binding:", e);
    }
  });

  // Send client→server messages into the page
  window.__stagehand_webmcp_send = function(payloadJson) {
    var payload;
    try { payload = JSON.parse(payloadJson); } catch(e) { payload = payloadJson; }
    window.postMessage({
      channel: "${MCP_CHANNEL}",
      type: "${MCP_TYPE}",
      direction: "client-to-server",
      payload: payload
    }, window.location.origin);
  };
})();
`;

export interface WebMCPTransportOptions {
  /**
   * Timeout in ms to wait for the WebMCP server on the page to respond
   * with `mcp-server-ready`. Defaults to 10000.
   */
  readyTimeoutMs?: number;
}

/**
 * MCP Transport that bridges JSON-RPC messages between a Node.js MCP Client
 * and a WebMCP TabServer running inside a browser page, using CDP
 * (Runtime.addBinding + Runtime.evaluate) as the communication channel.
 *
 * Wire protocol (WebMCP/MCP-B Tab transport):
 *   postMessage envelope: { channel, type:"mcp", direction, payload }
 *   Control signals: "mcp-check-ready" / "mcp-server-ready"
 *   Payload: JSONRPCMessage objects
 *
 * NOTE: This transport is valid for the lifetime of a single page load.
 * If the page navigates, the bridge is destroyed and the transport fires
 * `onclose`. Consumers should re-create the transport after navigation.
 */
export class WebMCPTransport implements Transport {
  private session: CDPSessionLike;
  private readyTimeoutMs: number;
  private bindingHandler: ((params: { name: string; payload: string }) => void) | null = null;
  private navigationHandler: (() => void) | null = null;
  private started = false;

  sessionId?: string;
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;

  constructor(session: CDPSessionLike, options?: WebMCPTransportOptions) {
    this.session = session;
    this.readyTimeoutMs = options?.readyTimeoutMs ?? 10_000;
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;

    try {
      // Enable required CDP domains
      await this.session.send("Runtime.enable");
      await this.session.send("Page.enable");

      // Install the Node→page binding so we can receive messages from the bridge.
      // Runtime.addBinding persists across navigations automatically in Chromium,
      // but the bridge script's message listener does not — so we also monitor
      // for navigation and fire onclose.
      await this.session.send("Runtime.addBinding", { name: BINDING_NAME });

      // Listen for binding calls
      this.bindingHandler = (params: { name: string; payload: string }) => {
        if (params.name !== BINDING_NAME) return;
        this.handleIncoming(params.payload);
      };
      this.session.on("Runtime.bindingCalled", this.bindingHandler);

      // Detect page navigation — the bridge is destroyed so we must close.
      this.navigationHandler = () => {
        this.onerror?.(new Error("Page navigated; WebMCP bridge destroyed."));
        void this.close();
      };
      this.session.on("Page.frameNavigated", this.navigationHandler);

      // Inject the bridge script into the page
      const evalResult = await this.session.send<{
        exceptionDetails?: { text?: string };
      }>("Runtime.evaluate", {
        expression: BRIDGE_SCRIPT,
        awaitPromise: false,
        returnByValue: true,
      });
      if (evalResult.exceptionDetails) {
        throw new Error(
          `Bridge injection failed: ${evalResult.exceptionDetails.text ?? "unknown error"}`,
        );
      }

      // Wait for the server to be ready
      await this.waitForServerReady();
    } catch (err) {
      // Reset state so start() can be retried
      this.started = false;
      this.removeListeners();
      throw err;
    }
  }

  async send(message: JSONRPCMessage): Promise<void> {
    // Double-stringify: the outer JSON.stringify produces a JS string literal
    // safe to embed in an expression; the bridge's __stagehand_webmcp_send
    // then JSON.parse()s it to recover the original object.
    const json = JSON.stringify(message);
    const result = await this.session.send<{
      exceptionDetails?: { text?: string };
    }>("Runtime.evaluate", {
      expression: `window.__stagehand_webmcp_send(${JSON.stringify(json)})`,
      awaitPromise: false,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      const err = new Error(
        `WebMCP send failed: ${result.exceptionDetails.text ?? "unknown error"}`,
      );
      this.onerror?.(err);
    }
  }

  async close(): Promise<void> {
    if (!this.started) return;
    this.started = false;

    this.removeListeners();

    // Remove the binding from the browser
    await this.session
      .send("Runtime.removeBinding", { name: BINDING_NAME })
      .catch(() => {});

    // Clean up bridge globals from page
    await this.session
      .send("Runtime.evaluate", {
        expression: `delete window.__stagehand_webmcp_bridge; delete window.__stagehand_webmcp_send;`,
        awaitPromise: false,
        returnByValue: true,
      })
      .catch(() => {});

    this.onclose?.();
  }

  private removeListeners(): void {
    if (this.bindingHandler) {
      this.session.off("Runtime.bindingCalled", this.bindingHandler);
      this.bindingHandler = null;
    }
    if (this.navigationHandler) {
      this.session.off("Page.frameNavigated", this.navigationHandler);
      this.navigationHandler = null;
    }
  }

  /**
   * Sends `mcp-check-ready` and waits for the server to reply
   * with `mcp-server-ready`.
   */
  private waitForServerReady(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let resolved = false;

      const cleanup = () => {
        this.session.off("Runtime.bindingCalled", readyHandler);
        clearTimeout(timer);
      };

      const timer = setTimeout(() => {
        if (resolved) return;
        resolved = true;
        cleanup();
        reject(
          new Error(
            `WebMCP server did not respond within ${this.readyTimeoutMs}ms. ` +
              `Ensure the page has a WebMCP/MCP-B TabServerTransport running.`,
          ),
        );
      }, this.readyTimeoutMs);

      const readyHandler = (params: { name: string; payload: string }) => {
        if (params.name !== BINDING_NAME) return;
        if (params.payload === SIGNAL_SERVER_READY) {
          if (resolved) return;
          resolved = true;
          cleanup();
          resolve();
        }
      };
      this.session.on("Runtime.bindingCalled", readyHandler);

      // Send the check-ready signal
      this.session
        .send("Runtime.evaluate", {
          expression: `window.__stagehand_webmcp_send(${JSON.stringify(JSON.stringify(SIGNAL_CHECK_READY))})`,
          awaitPromise: false,
          returnByValue: true,
        })
        .catch((err: unknown) => {
          if (resolved) return;
          resolved = true;
          cleanup();
          reject(err);
        });
    });
  }

  /**
   * Routes an incoming message string from the bridge.
   * Handles both control signals and JSON-RPC messages.
   */
  private handleIncoming(raw: string): void {
    // Control signals come as bare strings
    if (raw === SIGNAL_SERVER_READY) {
      // Already handled by waitForServerReady; ignore late arrivals
      return;
    }

    try {
      const message: JSONRPCMessage = JSON.parse(raw);
      this.onmessage?.(message);
    } catch {
      this.onerror?.(new Error(`Failed to parse WebMCP message: ${raw}`));
    }
  }
}
