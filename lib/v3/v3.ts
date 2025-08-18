import { launch, LaunchedChrome } from "chrome-launcher";
import Browserbase from "@browserbasehq/sdk";
import {
  V3Options,
  InitState,
  BrowserbaseSession,
  JsonVersionResponse,
  PlaywrightPage,
  PuppeteerPage,
  ActParams,
  ActHandlderParams,
  ExtractHandlerParams,
  ExtractParams,
  ObserveParams,
  ObserveHandlderParams,
} from "@/lib/v3/types";
import { ActHandler } from "./handlers/actHandler";
import { ExtractHandler } from "./handlers/extractHandler";
import { ObserveHandler } from "./handlers/observeHandler";

export class V3 {
  private readonly opts: V3Options;
  private state: InitState = { kind: "UNINITIALIZED" };
  private actHandler: ActHandler | null = null;
  private extractHandler: ExtractHandler | null = null;
  private observeHandler: ObserveHandler | null = null;

  constructor(opts: V3Options) {
    this.opts = opts;
  }

  /** Launches the chosen environment and prepares a CDP WebSocket to connect to. */
  async init(): Promise<void> {
    this.actHandler = new ActHandler();
    this.extractHandler = new ExtractHandler();
    this.observeHandler = new ObserveHandler();
    if (this.opts.env === "LOCAL") {
      const { ws, chrome } = await this.initLocal();
      this.state = { kind: "LOCAL", chrome, ws };
      return;
    }

    if (this.opts.env === "BROWSERBASE") {
      const { apiKey, projectId } = this.requireBrowserbaseCreds();
      const { ws, sessionId, bb } = await this.initBrowserbase(
        apiKey,
        projectId,
      );
      this.state = { kind: "BROWSERBASE", sessionId, ws, bb };
      return;
    }

    const neverEnv: never = this.opts.env;
    throw new Error(`Unsupported env: ${neverEnv}`);
  }

  async act(params: ActParams): Promise<void> {
    if (!this.actHandler)
      throw new Error("V3 not initialized. Call init() before act().");

    const frameId = params.page
      ? await this.resolveTopFrameId(params.page)
      : undefined;
    const handlerParams: ActHandlderParams = {
      instruction: params.instruction,
      frameId: frameId,
    };
    return this.actHandler.act(handlerParams);
  }

  async extract(params: ExtractParams): Promise<void> {
    if (!this.extractHandler) {
      throw new Error("V3 not initialized. Call init() before extract().");
    }
    const frameId = params.page
      ? await this.resolveTopFrameId(params.page)
      : undefined;

    const handlerParams: ExtractHandlerParams = {
      instruction: params.instruction,
      frameId: frameId,
    };
    return this.extractHandler.extract(handlerParams);
  }

  async observe(params: ObserveParams): Promise<void> {
    if (!this.observeHandler) {
      throw new Error("V3 not initialized. Call init() before observe().");
    }
    const frameId = params.page
      ? await this.resolveTopFrameId(params.page)
      : undefined;

    const handlerParams: ObserveHandlderParams = {
      instruction: params.instruction,
      frameId: frameId,
    };

    return this.observeHandler.observe(handlerParams);
  }

  /** Returns the browser-level CDP WebSocket endpoint. */
  connectURL(): string {
    if (this.state.kind === "UNINITIALIZED") {
      throw new Error("V3 not initialized. Call await v3.init() first.");
    }
    return this.state.ws;
  }

  /** Best-effort cleanup. */
  async close(): Promise<void> {
    if (this.state.kind === "LOCAL") {
      await this.state.chrome.kill();
      this.state = { kind: "UNINITIALIZED" };
      return;
    }

    if (this.state.kind === "BROWSERBASE") {
      this.state = { kind: "UNINITIALIZED" };
    }
  }

  private async initLocal(): Promise<{ ws: string; chrome: LaunchedChrome }> {
    const headless = this.opts.headless ?? true;
    const chromeFlags = [
      headless ? "--headless=new" : undefined,
      "--remote-allow-origins=*",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-dev-shm-usage",
      this.opts.userDataDir
        ? `--user-data-dir=${this.opts.userDataDir}`
        : undefined,
      ...(this.opts.chromeFlags ?? []),
    ].filter((f): f is string => typeof f === "string");

    const chrome = await launch({
      chromePath: this.opts.chromePath,
      chromeFlags,
    });

    const timeoutMs = this.opts.connectTimeoutMs ?? 15_000;
    const ws = await this.waitForWebSocketDebuggerUrl(chrome.port, timeoutMs);
    return { ws, chrome };
  }

  private requireBrowserbaseCreds(): { apiKey: string; projectId: string } {
    const { apiKey, projectId } = this.opts;
    if (!apiKey || !projectId) {
      throw new Error(
        "BROWSERBASE requires both apiKey and projectId in V3Options.",
      );
    }
    return { apiKey, projectId };
  }

  private async initBrowserbase(
    apiKey: string,
    projectId: string,
  ): Promise<{ ws: string; sessionId: string; bb: Browserbase }> {
    const bb = new Browserbase({ apiKey });
    const session = (await bb.sessions.create({
      projectId,
    })) as BrowserbaseSession;

    if (!session?.connectUrl || !session?.id) {
      throw new Error(
        "Browserbase session creation returned an unexpected shape.",
      );
    }

    return { ws: session.connectUrl, sessionId: session.id, bb };
  }

  private async waitForWebSocketDebuggerUrl(
    port: number,
    timeoutMs: number,
  ): Promise<string> {
    const deadline = Date.now() + timeoutMs;
    let lastErrMsg = "";

    while (Date.now() < deadline) {
      try {
        const resp = await fetch(`http://127.0.0.1:${port}/json/version`);
        if (resp.ok) {
          const json = (await resp.json()) as unknown;
          if (this.isJsonVersionResponse(json)) {
            return json.webSocketDebuggerUrl;
          }
        } else {
          lastErrMsg = `${resp.status} ${resp.statusText}`;
        }
      } catch (err) {
        lastErrMsg = err instanceof Error ? err.message : String(err);
      }
      await new Promise((r) => setTimeout(r, 250));
    }

    throw new Error(
      `Timed out waiting for /json/version on port ${port}${
        lastErrMsg ? ` (last error: ${lastErrMsg})` : ""
      }`,
    );
  }

  private isJsonVersionResponse(v: unknown): v is JsonVersionResponse {
    return (
      typeof v === "object" &&
      v !== null &&
      typeof (v as { webSocketDebuggerUrl?: unknown }).webSocketDebuggerUrl ===
        "string"
    );
  }

  private async resolveTopFrameId(
    page: PlaywrightPage | PuppeteerPage,
  ): Promise<string> {
    if (this.isPlaywrightPage(page)) {
      const cdp = await page.context().newCDPSession(page);
      const { frameTree } = await cdp.send("Page.getFrameTree");
      return frameTree.frame.id;
    }

    if (this.isPuppeteerPage(page)) {
      const cdp = await page.target().createCDPSession();
      const { frameTree } = await cdp.send("Page.getFrameTree");
      console.log("[ActHandler] Puppeteer frame id:", frameTree.frame.id);
      return frameTree.frame.id;
    }

    throw new Error("Unsupported page object passed to V3.act()");
  }

  private isPlaywrightPage(p: unknown): p is PlaywrightPage {
    return (
      typeof p === "object" &&
      p !== null &&
      typeof (p as PlaywrightPage).context === "function"
    );
  }

  private isPuppeteerPage(p: unknown): p is PuppeteerPage {
    return (
      typeof p === "object" &&
      p !== null &&
      typeof (p as PuppeteerPage).target === "function"
    );
  }
}
