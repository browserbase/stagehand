import { randomUUID } from "node:crypto";
import puppeteer, { type Browser } from "puppeteer-core";
import type {
  BrowserSessionMetadata,
  BrowserSessionOptions,
  BrowserTargetName,
} from "../types.js";
import { MultiagentError } from "../utils/errors.js";

function deriveBrowserUrl(cdpUrl?: string): string | undefined {
  if (!cdpUrl) {
    return undefined;
  }

  if (cdpUrl.startsWith("http://") || cdpUrl.startsWith("https://")) {
    return cdpUrl;
  }

  try {
    const url = new URL(cdpUrl);
    if (url.protocol === "ws:" || url.protocol === "wss:") {
      url.protocol = url.protocol === "ws:" ? "http:" : "https:";
      url.pathname = "";
      url.search = "";
      url.hash = "";
      return url.toString().replace(/\/$/, "");
    }
  } catch {
    // best-effort normalization only
  }

  return undefined;
}

function normalizeType(options: BrowserSessionOptions): BrowserTargetName {
  return options.type ?? (options.cdpUrl ? "cdp" : "local");
}

export class BrowserSession {
  private browser: Browser | null = null;
  private connected = false;
  private readonly id = randomUUID();
  private cdpUrl?: string;
  private browserUrl?: string;
  private readonly type: BrowserTargetName;
  private readonly launched: boolean;

  constructor(private readonly options: BrowserSessionOptions = {}) {
    this.type = normalizeType(options);
    this.launched = this.type === "local";
  }

  async start(): Promise<void> {
    if (this.connected) {
      return;
    }

    if (this.type === "cdp") {
      const cdpUrl = this.options.cdpUrl?.trim();
      if (!cdpUrl) {
        throw new MultiagentError(
          "BrowserSession configured for CDP mode without a cdpUrl.",
        );
      }

      this.browser =
        cdpUrl.startsWith("http://") || cdpUrl.startsWith("https://")
          ? await puppeteer.connect({
              browserURL: cdpUrl,
              protocolTimeout: this.options.connectTimeoutMs,
            })
          : await puppeteer.connect({
              browserWSEndpoint: cdpUrl,
              protocolTimeout: this.options.connectTimeoutMs,
            });
      this.cdpUrl = this.browser.wsEndpoint();
      this.browserUrl = deriveBrowserUrl(this.cdpUrl) ?? deriveBrowserUrl(cdpUrl);
      this.connected = true;
      return;
    }

    this.browser = await puppeteer.launch({
      channel: this.options.executablePath ? undefined : this.options.channel ?? "chrome",
      executablePath: this.options.executablePath,
      headless: this.options.headless ?? true,
      userDataDir: this.options.userDataDir,
      args: [
        "--remote-allow-origins=*",
        "--no-first-run",
        "--no-default-browser-check",
        ...(this.options.ignoreHTTPSErrors
          ? ["--ignore-certificate-errors"]
          : []),
        ...(this.options.args ?? []),
      ],
      defaultViewport: this.options.viewport ?? null,
      protocolTimeout: this.options.connectTimeoutMs,
    });

    this.cdpUrl = this.browser.wsEndpoint();
    this.browserUrl = deriveBrowserUrl(this.cdpUrl);
    this.connected = true;
  }

  async stop(): Promise<void> {
    if (!this.browser) {
      return;
    }

    if (this.launched) {
      await this.browser.close();
    } else {
      await this.browser.disconnect();
    }

    this.browser = null;
    this.connected = false;
  }

  getMetadata(): BrowserSessionMetadata {
    return {
      id: this.id,
      type: this.type,
      cdpUrl: this.cdpUrl,
      browserUrl: this.browserUrl,
      launched: this.launched,
      headless: this.options.headless ?? true,
      userDataDir: this.options.userDataDir,
      viewport: this.options.viewport,
    };
  }

  getCdpUrl(): string | undefined {
    return this.cdpUrl;
  }

  getBrowserUrl(): string | undefined {
    return this.browserUrl;
  }
}
