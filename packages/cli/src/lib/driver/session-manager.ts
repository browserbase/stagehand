import { Stagehand } from "@browserbasehq/stagehand";

import {
  emptyRefMaps,
  resolveSelector as resolveCachedSelector,
  type RefMaps,
} from "./commands/selectors.js";
import { executeDriverCommand } from "./commands/registry.js";
import type { DriverCommandName } from "./commands/types.js";
import { discoverLocalCdp } from "./local-cdp-discovery.js";
import { NetworkCapture } from "./network-capture.js";
import { getRemote } from "./remote-binding.js";
import type {
  ConnectionTarget,
  DriverStatus,
  OpenResult,
  PageSummary,
} from "./types.js";

export type DriverContext = Stagehand["context"];
export type DriverPage = Awaited<ReturnType<DriverContext["awaitActivePage"]>>;

const INIT_FAILURE_RETRY_MS = 5_000;

interface InitFailure {
  error: unknown;
  retryAt: number;
}

export class DriverSessionManager {
  readonly network: NetworkCapture;

  private context: DriverContext | null = null;
  private initFailure: InitFailure | null = null;
  private initPromise: Promise<void> | null = null;
  private refMaps: RefMaps = emptyRefMaps();
  private selectedTargetId: string | undefined;
  private stagehand: Stagehand | null = null;

  constructor(
    private readonly session: string,
    private readonly target: ConnectionTarget,
  ) {
    this.network = new NetworkCapture(session);
  }

  async open(url: string): Promise<OpenResult> {
    return (await this.execute("open", { url })) as OpenResult;
  }

  async execute(
    command: DriverCommandName,
    params?: unknown,
  ): Promise<unknown> {
    return executeDriverCommand(this, command, params);
  }

  async activePage(): Promise<DriverPage> {
    return this.ensurePage();
  }

  async pageForOpen(): Promise<DriverPage> {
    return this.ensurePage({ createIfMissing: true });
  }

  async browserContext(): Promise<DriverContext> {
    await this.ensureInitialized();
    if (!this.context) {
      throw new Error("Driver context failed to initialize.");
    }

    return this.context;
  }

  async stagehandInstance(): Promise<Stagehand> {
    await this.ensureInitialized();
    if (!this.stagehand) {
      throw new Error("Stagehand instance failed to initialize.");
    }

    return this.stagehand;
  }

  async status(): Promise<DriverStatus> {
    if (!this.stagehand || !this.context) {
      return {
        browserConnected: false,
        initialized: false,
        mode: this.target.kind,
        pages: [],
        pid: process.pid,
        selectedTargetId: this.selectedTargetId,
        session: this.session,
        target: this.target,
      };
    }

    const page = this.activePageIfPresent();
    const pages = await this.pageSummaries();
    return {
      browserConnected: true,
      initialized: true,
      mode: this.target.kind,
      pages,
      pid: process.pid,
      selectedTargetId: page?.targetId() ?? this.selectedTargetId,
      session: this.session,
      target: this.target,
      title: page ? await safeTitle(page) : undefined,
      url: page?.url(),
    };
  }

  async close(): Promise<void> {
    const stagehand = this.stagehand;
    this.stagehand = null;
    this.context = null;
    this.initFailure = null;
    await this.network.disable().catch(() => undefined);
    if (stagehand) {
      await stagehand.close().catch(() => undefined);
    }
  }

  resolveSelector(selector: string): string {
    return resolveCachedSelector(selector, this.refMaps);
  }

  setRefMaps(refMaps: RefMaps): void {
    this.refMaps = refMaps;
  }

  getRefMaps(): RefMaps {
    return this.refMaps;
  }

  async openResult(page: DriverPage): Promise<OpenResult> {
    return {
      mode: this.target.kind,
      pages: await this.pageSummaries(),
      selectedTargetId: page.targetId(),
      session: this.session,
      title: await this.safeTitle(page),
      url: page.url(),
    };
  }

  async pageSummaries(): Promise<PageSummary[]> {
    const pages = this.context?.pages() ?? [];
    return Promise.all(
      pages.map(async (page, index) => ({
        index,
        targetId: page.targetId(),
        title: await this.safeTitle(page),
        url: page.url(),
      })),
    );
  }

  async safeTitle(page: DriverPage): Promise<string> {
    return safeTitle(page);
  }

  private async ensurePage(
    options: { createIfMissing?: boolean } = {},
  ): Promise<DriverPage> {
    await this.ensureInitialized();
    if (!this.context) {
      throw new Error("Driver context failed to initialize.");
    }

    const target = this.target;
    if (target.kind === "cdp" && target.targetId) {
      const page = this.context
        .pages()
        .find((candidate) => candidate.targetId() === target.targetId);
      if (!page) {
        throw new Error(
          `Target ${target.targetId} was not found in the attached browser.`,
        );
      }
      this.context.setActivePage(page);
      this.selectedTargetId = page.targetId();
      return page;
    }

    const existingPage = this.activePageIfPresent() ?? this.context.pages()[0];
    if (existingPage) {
      this.context.setActivePage(existingPage);
      this.selectedTargetId = existingPage.targetId();
      return existingPage;
    }

    if (options.createIfMissing) {
      const page = await this.context.newPage();
      this.context.setActivePage(page);
      this.selectedTargetId = page.targetId();
      return page;
    }

    throw new Error(
      `No active page in session "${this.session}". Run browse open <url> --session ${this.session} or browse tab new <url> --session ${this.session}.`,
    );
  }

  private activePageIfPresent(): DriverPage | undefined {
    try {
      return this.context?.activePage() ?? undefined;
    } catch {
      return undefined;
    }
  }

  private async ensureInitialized(): Promise<void> {
    if (this.stagehand && this.context) return;
    if (this.initPromise) return this.initPromise;

    if (this.initFailure) {
      if (Date.now() < this.initFailure.retryAt) {
        throw this.initFailure.error;
      }
      this.initFailure = null;
    }

    this.initPromise = this.initialize()
      .then(() => {
        this.initFailure = null;
      })
      .catch((error: unknown) => {
        this.initFailure = {
          error,
          retryAt: Date.now() + INIT_FAILURE_RETRY_MS,
        };
        throw error;
      })
      .finally(() => {
        this.initPromise = null;
      });
    return this.initPromise;
  }

  private async initialize(): Promise<void> {
    const resolvedTarget = await this.resolveTarget();
    const options = await this.stagehandOptions(resolvedTarget);
    const stagehand = new Stagehand(options);

    try {
      await stagehand.init();
    } catch (error) {
      await stagehand.close().catch(() => undefined);
      throw error;
    }
    this.stagehand = stagehand;
    this.context = stagehand.context;
  }

  private async resolveTarget(): Promise<ConnectionTarget> {
    if (this.target.kind !== "auto-connect") return this.target;

    const discovered = await discoverLocalCdp();
    if (!discovered) {
      throw new Error(
        "No debuggable local browser found. Start Chrome with --remote-debugging-port=9222 or pass --cdp <url|port>.",
      );
    }

    return { kind: "cdp", endpoint: discovered.wsUrl };
  }

  private async stagehandOptions(
    target: ConnectionTarget,
  ): Promise<ConstructorParameters<typeof Stagehand>[0]> {
    if (target.kind === "remote") {
      return (await getRemote()).remoteStagehandOptions();
    }

    if (target.kind === "managed-local") {
      return {
        disablePino: true,
        env: "LOCAL",
        localBrowserLaunchOptions: {
          ...(target.chromeArgs?.length ? { args: target.chromeArgs } : {}),
          ...(target.ignoreDefaultArgs !== undefined
            ? { ignoreDefaultArgs: target.ignoreDefaultArgs }
            : {}),
          headless: target.headless,
        },
        verbose: 0,
      };
    }

    if (target.kind === "cdp") {
      return {
        disablePino: true,
        env: "LOCAL",
        localBrowserLaunchOptions: {
          cdpUrl: target.endpoint,
        },
        verbose: 0,
      };
    }

    throw new Error(`Unsupported target kind: ${target.kind}`);
  }
}

async function safeTitle(page: DriverPage): Promise<string> {
  try {
    return await page.title();
  } catch {
    return "";
  }
}
