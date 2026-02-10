import type {
  Transport,
  TransportSendOptions,
} from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import type { Protocol } from "devtools-protocol";
import type { Page } from "../understudy/page";

const DEFAULT_CHANNEL = "mcp";
const READY_PING = "mcp-check-ready";
const READY_PONG = "mcp-server-ready";

export type CDPTabClientTransportOptions = {
  channel?: string;
  timeoutMs?: number;
  waitForReady?: boolean;
  enableModelContextShim?: boolean;
};

export class CDPTabClientTransport implements Transport {
  public onclose?: () => void;
  public onerror?: (error: Error) => void;
  public onmessage?: (message: JSONRPCMessage) => void;

  private readonly page: Page;
  private readonly channel: string;
  private readonly timeoutMs: number;
  private readonly waitForReady: boolean;
  private readonly enableModelContextShim: boolean;
  private readonly bindingName: string;
  private started = false;
  private closed = false;
  private bindingHandler?: (evt: Protocol.Runtime.BindingCalledEvent) => void;
  private readyPromise: Promise<void> | null = null;
  private readyResolve?: () => void;
  private readyReject?: (error: Error) => void;
  private readyCompleted = false;

  constructor(page: Page, options?: CDPTabClientTransportOptions) {
    this.page = page;
    this.channel = options?.channel ?? DEFAULT_CHANNEL;
    this.timeoutMs = options?.timeoutMs ?? 5000;
    this.waitForReady = options?.waitForReady ?? false;
    this.enableModelContextShim = options?.enableModelContextShim ?? false;
    this.bindingName = `__stagehand_mcp_recv_${Math.random().toString(36).slice(2)}`;
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;

    await this.page.sendCDP("Runtime.enable").catch(() => {});
    await this.page
      .sendCDP("Runtime.addBinding", { name: this.bindingName })
      .catch(() => {});

    this.bindingHandler = (evt: Protocol.Runtime.BindingCalledEvent) => {
      if (evt.name !== this.bindingName) return;
      const payload = String(evt.payload ?? "");
      if (payload === READY_PONG) {
        this.resolveReady();
        return;
      }

      try {
        const message = JSON.parse(payload) as JSONRPCMessage;
        this.onmessage?.(message);
      } catch (error) {
        this.onerror?.(error as Error);
      }
    };

    this.page.onCDP("Runtime.bindingCalled", this.bindingHandler);

    await this.installBridge();

    if (this.waitForReady) {
      await this.waitForReadyHandshake();
    }
  }

  async send(
    message: JSONRPCMessage,
    _options?: TransportSendOptions,
  ): Promise<void> {
    if (this.closed) return;
    await this.postMessage(message);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;

    if (this.bindingHandler) {
      this.page.offCDP("Runtime.bindingCalled", this.bindingHandler);
    }

    await this.page
      .sendCDP("Runtime.removeBinding", { name: this.bindingName })
      .catch(() => {});

    this.onclose?.();
  }

  private async waitForReadyHandshake(): Promise<void> {
    if (this.readyCompleted) return;
    if (this.readyPromise) return this.readyPromise;

    this.readyPromise = new Promise((resolve, reject) => {
      this.readyResolve = () => {
        if (this.readyCompleted) return;
        this.readyCompleted = true;
        resolve();
      };
      this.readyReject = (error) => {
        if (this.readyCompleted) return;
        this.readyCompleted = true;
        reject(error);
      };
      const deadline = Date.now() + this.timeoutMs;

      const tick = async () => {
        if (this.readyCompleted) return;
        if (Date.now() > deadline) {
          const error = new Error("Timed out waiting for WebMCP server");
          this.readyReject?.(error);
          this.onerror?.(error);
          return;
        }
        await this.postMessage(READY_PING);
        setTimeout(tick, 150);
      };

      void tick();
    });

    return this.readyPromise;
  }

  private resolveReady(): void {
    if (this.readyCompleted) return;
    if (this.readyResolve) {
      this.readyResolve();
    } else {
      this.readyCompleted = true;
    }
    this.readyResolve = undefined;
    this.readyReject = undefined;
  }

  private async postMessage(payload: unknown): Promise<void> {
    await this.page.evaluate(
      (data) => {
        window.postMessage(
          {
            channel: data.channel,
            type: "mcp",
            direction: "client-to-server",
            payload: data.payload,
          },
          "*",
        );
      },
      { channel: this.channel, payload },
    );
  }

  private async installBridge(): Promise<void> {
    const bridge = `(() => {
      const channel = ${JSON.stringify(this.channel)};
      const bindingName = ${JSON.stringify(this.bindingName)};
      const enableShim = ${this.enableModelContextShim};
      const gateReadyOnTools = ${this.waitForReady};
      const registry = window.__stagehandMcpBridgeRegistry ||
        (window.__stagehandMcpBridgeRegistry = {});
      if (registry[bindingName]) return;
      registry[bindingName] = true;

      const toolRegistry = window.__stagehandMcpToolRegistry ||
        (window.__stagehandMcpToolRegistry = new Map());
      let readyPending = false;

      const send = (payload) => {
        window.postMessage(
          {
            channel,
            type: "mcp",
            direction: "server-to-client",
            payload,
          },
          "*",
        );
      };

      const maybeSendReady = () => {
        if (!gateReadyOnTools || toolRegistry.size > 0) {
          send("mcp-server-ready");
          readyPending = false;
        }
      };

      const patchModelContext = () => {
        const mc = navigator.modelContext;
        if (!mc || mc.__stagehandPatched) return Boolean(mc);
        Object.defineProperty(mc, "__stagehandPatched", { value: true });

        const originalRegister = mc.registerTool ? mc.registerTool.bind(mc) : null;
        const originalUnregister = mc.unregisterTool ? mc.unregisterTool.bind(mc) : null;
        const originalProvide = mc.provideContext ? mc.provideContext.bind(mc) : null;
        const originalClear = mc.clearContext ? mc.clearContext.bind(mc) : null;

        const trackTool = (tool) => {
          if (!tool || !tool.name) return;
          toolRegistry.set(tool.name, tool);
          if (readyPending) {
            maybeSendReady();
          }
        };

        mc.registerTool = (tool) => {
          trackTool(tool);
          const reg = originalRegister ? originalRegister(tool) : null;
          if (reg && typeof reg.unregister === "function") {
            const orig = reg.unregister.bind(reg);
            reg.unregister = () => {
              if (tool && tool.name) toolRegistry.delete(tool.name);
              return orig();
            };
          }
          return reg ?? {
            unregister: () => {
              if (tool && tool.name) toolRegistry.delete(tool.name);
            },
          };
        };

        if (originalUnregister) {
          mc.unregisterTool = (name) => {
            if (name) toolRegistry.delete(name);
            return originalUnregister(name);
          };
        }

        if (originalProvide) {
          mc.provideContext = (ctx) => {
            if (ctx && Array.isArray(ctx.tools)) {
              toolRegistry.clear();
              ctx.tools.forEach(trackTool);
            }
            return originalProvide(ctx);
          };
        }

        if (originalClear) {
          mc.clearContext = () => {
            toolRegistry.clear();
            return originalClear();
          };
        }

        return true;
      };

      if (enableShim) {
        if (!patchModelContext()) {
          const interval = setInterval(() => {
            if (patchModelContext()) {
              clearInterval(interval);
            }
          }, 50);
        }
      }

      window.addEventListener("message", (event) => {
        const data = event.data;
        if (!data || data.type !== "mcp") return;
        if (data.channel !== channel) return;

        if (data.direction === "server-to-client") {
          try {
            const payload =
              typeof data.payload === "string"
                ? data.payload
                : JSON.stringify(data.payload);
            window[bindingName](payload);
          } catch {
            // Ignore serialization/binding failures.
          }
          return;
        }

        if (!enableShim) return;
        if (data.direction !== "client-to-server") return;

        const payload = data.payload;

        if (payload === "mcp-check-ready") {
          if (gateReadyOnTools && toolRegistry.size === 0) {
            readyPending = true;
          } else {
            maybeSendReady();
          }
          return;
        }

        if (!payload || payload.jsonrpc !== "2.0") return;

        const { id, method, params } = payload;
        const reply = (result) => send({ jsonrpc: "2.0", id, result });
        const replyError = (message) =>
          send({
            jsonrpc: "2.0",
            id,
            error: { code: -32601, message },
          });

        if (method === "initialize") {
          reply({
            protocolVersion: params?.protocolVersion ?? "2024-11-05",
            capabilities: { tools: {} },
            serverInfo: { name: "Stagehand WebMCP Shim", version: "0.1.0" },
          });
          return;
        }

        if (method === "ping") {
          reply({});
          return;
        }

        if (method === "tools/list") {
          const tools = Array.from(toolRegistry.values()).map((tool) => ({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
          }));
          reply({ tools });
          return;
        }

        if (method === "tools/call") {
          const tool = toolRegistry.get(params?.name);
          if (!tool) {
            replyError("Tool not found: " + (params?.name ?? ""));
            return;
          }
          const execute = tool.execute || tool.handler;
          Promise.resolve(execute ? execute(params?.arguments ?? {}) : null)
            .then((result) => {
              if (!result || typeof result !== "object") {
                reply({
                  content: [{ type: "text", text: String(result ?? "") }],
                });
                return;
              }
              reply(result);
            })
            .catch((error) => {
              send({
                jsonrpc: "2.0",
                id,
                error: {
                  code: -32603,
                  message: String(
                    error?.message ?? error ?? "Tool execution failed",
                  ),
                },
              });
            });
          return;
        }

        replyError("Method not found: " + (method ?? ""));
      });
    })();`;

    await this.page.addInitScript(bridge);
    await this.page.evaluate(bridge);
  }
}
