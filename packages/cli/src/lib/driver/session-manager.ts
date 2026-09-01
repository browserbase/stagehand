import {
  localBrowser,
  Stagehand,
  type StagehandBrowser,
} from "@browserbasehq/stagehand";

import {
  emptyRefMaps,
  resolveSelector as resolveCachedSelector,
  type RefMaps,
} from "./commands/selectors.js";
import { executeDriverCommand } from "./commands/registry.js";
import type { DriverCommandName } from "./commands/types.js";
import {
  forwardedEnvSignature,
  type ForwardedEnv,
} from "./daemon/forwarded-env.js";
import { DriverError } from "./errors.js";
import { discoverLocalCdp } from "./local-cdp-discovery.js";
import { NetworkCapture } from "./network-capture.js";
import { getRemote } from "./remote-binding.js";
import type {
  BrowserbaseIdentity,
  ConnectionTarget,
  DriverStatus,
  OpenResult,
  PageSummary,
} from "./types.js";

export type DriverContext = Stagehand["browser"]["context"];
export type DriverPage = NonNullable<
  Awaited<ReturnType<DriverContext["activePage"]>>
>;

const INIT_FAILURE_RETRY_MS = 5_000;
const INIT_FAILURE_RETRY_MAX_MS = 60_000;

// chrome-launcher reports "no Chrome on this machine" with these codes (its
// LaunchErrorCodes const enum, which can't be imported directly: const enums
// are erased at build time and isolatedModules forbids cross-module access).
const CHROME_NOT_FOUND_ERROR_CODES = new Set([
  "ERR_LAUNCHER_NOT_INSTALLED",
  "ERR_LAUNCHER_PATH_NOT_SET",
]);

interface InitFailure {
  error: unknown;
  retryAt: number;
}

/**
 * Exponential backoff for cached init failures: 5s, 10s, 20s, ... capped at
 * 1 minute. Prevents agents stuck in retry loops from hammering init while
 * still allowing a quick retry after the first failure.
 */
export function initFailureBackoffMs(consecutiveFailures: number): number {
  const attempt = Math.max(1, consecutiveFailures);
  return Math.min(
    INIT_FAILURE_RETRY_MS * 2 ** (attempt - 1),
    INIT_FAILURE_RETRY_MAX_MS,
  );
}

export function isChromeNotFoundError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null | undefined)?.code;
  if (typeof code === "string" && CHROME_NOT_FOUND_ERROR_CODES.has(code)) {
    return true;
  }
  return (
    error instanceof Error &&
    error.message.includes("No Chrome installations found")
  );
}

export class DriverSessionManager {
  readonly network: NetworkCapture;

  private browser: StagehandBrowser | null = null;
  private browserbaseIdentityValue: BrowserbaseIdentity = {};
  private consecutiveInitFailures = 0;
  private context: DriverContext | null = null;
  private lastForwardedEnvSignature: string | null = null;
  private pendingEnv: ForwardedEnv | undefined;
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

  /**
   * Apply env vars forwarded by the client (e.g. an inline or exported API
   * key set after the daemon started). Honoring a late key without a manual
   * restart is the whole point of forwarding.
   *
   * The forwarded env is stashed for the next `init()`, which threads it
   * straight into the Stagehand constructor — never into `process.env` — so the
   * key's only home is the live session. A live, already-initialized session
   * keeps its existing browser (forwarded env only matters at init), so the
   * warm-daemon fast path is untouched. When the forwarded env changes *before*
   * a successful init (the common case: a first key-less `open` failed, then a
   * key is supplied), clear the cached init failure and backoff so the retry
   * runs immediately with the new key instead of replaying the stale
   * missing-key error.
   */
  applyForwardedEnv(forwardedEnv: ForwardedEnv | undefined): void {
    // Keep the caller's latest forwarded env available to the next init.
    this.pendingEnv = forwardedEnv;

    const signature = forwardedEnvSignature(forwardedEnv);
    if (signature === this.lastForwardedEnvSignature) return;
    this.lastForwardedEnvSignature = signature;

    if (this.stagehand && this.context) return;
    this.initFailure = null;
    this.consecutiveInitFailures = 0;
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

    const page = await this.activePageIfPresent();
    const pages = await this.pageSummaries();
    return {
      ...this.browserbaseIdentity(),
      browserConnected: true,
      initialized: true,
      mode: this.target.kind,
      pages,
      pid: process.pid,
      selectedTargetId: page?.pageId ?? this.selectedTargetId,
      session: this.session,
      target: this.target,
      title: page ? await safeTitle(page) : undefined,
      url: page ? await page.url() : undefined,
    };
  }

  /**
   * Browserbase session identity (id, dashboard URL, live-view/debug URL) for a
   * live remote session. Lets `status`/`open`/`doctor` reason about the cloud
   * session instead of losing it the way a raw `--cdp` attach does. Empty for
   * non-remote targets or before the driver has initialized.
   */
  private browserbaseIdentity(): BrowserbaseIdentity {
    return this.target.kind === "remote" ? this.browserbaseIdentityValue : {};
  }

  async close(): Promise<void> {
    const stagehand = this.stagehand;
    const browser = this.browser;
    this.stagehand = null;
    this.browser = null;
    this.context = null;
    this.browserbaseIdentityValue = {};
    this.initFailure = null;
    this.consecutiveInitFailures = 0;
    await this.network.disable().catch(() => undefined);
    if (stagehand) {
      await stagehand.close().catch(() => undefined);
    }
    if (browser?.origin === "launched") {
      await browser.close().catch(() => undefined);
    }
  }

  resolveSelector(selector: string): string {
    return resolveCachedSelector(selector, this.refMaps);
  }

  setRefMaps(refMaps: RefMaps): void {
    this.refMaps = refMaps;
  }

  async openResult(page: DriverPage): Promise<OpenResult> {
    return {
      ...this.browserbaseIdentity(),
      mode: this.target.kind,
      pages: await this.pageSummaries(),
      selectedTargetId: page.pageId,
      session: this.session,
      title: await this.safeTitle(page),
      url: await page.url(),
    };
  }

  async pageSummaries(): Promise<PageSummary[]> {
    const pages = this.context ? await this.context.pages() : [];
    return Promise.all(
      pages.map(async (page, index) => ({
        index,
        targetId: page.pageId,
        title: await this.safeTitle(page),
        url: await page.url(),
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
      const page = (await this.context.pages()).find(
        (candidate) => candidate.pageId === target.targetId,
      );
      if (!page) {
        throw new Error(
          `Target ${target.targetId} was not found in the attached browser.`,
        );
      }
      await this.activateIfNeeded(page);
      this.selectedTargetId = page.pageId;
      return page;
    }

    const existingPage =
      (await this.activePageIfPresent()) ?? (await this.context.pages())[0];
    if (existingPage) {
      await this.activateIfNeeded(existingPage);
      this.selectedTargetId = existingPage.pageId;
      return existingPage;
    }

    if (options.createIfMissing) {
      const page = await this.context.newPage();
      await this.activateIfNeeded(page);
      this.selectedTargetId = page.pageId;
      return page;
    }

    throw new DriverError(
      `No active page in session "${this.session}". Run browse open <url> --session ${this.session} or browse tab new <url> --session ${this.session}.`,
      { code: "no_active_page" },
    );
  }

  private async activePageIfPresent(): Promise<DriverPage | undefined> {
    try {
      return (await this.context?.activePage()) ?? undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Mark `page` active only when it isn't already the active page.
   *
   * `setActivePage` ends in a CDP `Target.activateTarget`, which on macOS
   * raises the whole Chrome app to the OS foreground and steals keyboard focus.
   * The daemon resolves the active page on every subcommand, so calling this
   * unconditionally yanks focus away from the user's editor/terminal on each
   * command in headed local mode. Skipping the redundant re-activation keeps a
   * headed session usable alongside a coding agent.
   */
  private async activateIfNeeded(page: DriverPage): Promise<void> {
    if (page.pageId !== (await this.activePageIfPresent())?.pageId) {
      await this.context?.setActivePage(page);
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
        this.consecutiveInitFailures = 0;
      })
      .catch(async (error: unknown) => {
        this.consecutiveInitFailures += 1;
        const failure = await this.markRepeatedInitFailure(error);
        this.initFailure = {
          error: failure,
          retryAt:
            Date.now() + initFailureBackoffMs(this.consecutiveInitFailures),
        };
        throw failure;
      })
      .finally(() => {
        this.initPromise = null;
      });
    return this.initPromise;
  }

  private async markRepeatedInitFailure(error: unknown): Promise<unknown> {
    if (this.consecutiveInitFailures < 3 || !(error instanceof Error)) {
      return error;
    }
    const hint = (await getRemote()).driverInitHints().repeatedInitFailure;
    if (!error.message.includes(hint)) {
      error.message += hint;
    }
    return error;
  }

  private async initialize(): Promise<void> {
    const resolvedTarget = await this.resolveTarget();
    let browser: StagehandBrowser | undefined;

    try {
      if (resolvedTarget.kind === "remote") {
        const remote = await (
          await getRemote()
        ).launchRemoteBrowser(resolvedTarget, this.pendingEnv);
        browser = remote.browser;
        this.browserbaseIdentityValue = remote.identity;
      } else if (resolvedTarget.kind === "managed-local") {
        browser = await localBrowser.launch({
          ...(resolvedTarget.chromeArgs?.length
            ? { args: resolvedTarget.chromeArgs }
            : {}),
          ...(resolvedTarget.ignoreDefaultArgs === undefined
            ? {}
            : { ignoreDefaultArgs: resolvedTarget.ignoreDefaultArgs }),
          headless: resolvedTarget.headless,
        });
      } else if (resolvedTarget.kind === "cdp") {
        browser = await localBrowser.connect({
          cdpUrl: resolvedTarget.endpoint,
        });
      } else {
        throw new Error(`Unsupported target kind: ${resolvedTarget.kind}`);
      }

      const stagehand = await Stagehand.create({
        browser,
        logging: { level: "off" },
      });
      this.browser = browser;
      this.stagehand = stagehand;
      this.context = stagehand.browser.context;
    } catch (error) {
      if (browser?.origin === "launched") {
        await browser.close().catch(() => undefined);
      }
      this.browserbaseIdentityValue = {};
      throw await describeInitError(error, resolvedTarget);
    }
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
}

async function safeTitle(page: DriverPage): Promise<string> {
  try {
    return await page.title();
  } catch {
    return "";
  }
}

/**
 * Turn raw `stagehand.init()` failures into typed, actionable errors. Remote
 * failures are classified by the remote capability (401/403/etc.); a missing
 * local Chrome gets install/escape-hatch guidance. Anything else is rethrown
 * unchanged.
 */
async function describeInitError(
  error: unknown,
  target: ConnectionTarget,
): Promise<unknown> {
  if (error instanceof DriverError) return error;

  if (target.kind === "remote") {
    const { code, httpStatus, message } = (
      await getRemote()
    ).classifyRemoteInitError(error);
    return new DriverError(message, { code, httpStatus });
  }

  if (target.kind === "managed-local" && isChromeNotFoundError(error)) {
    return new DriverError(
      (await getRemote()).driverInitHints().chromeNotFound,
      {
        cause: error,
        code: "no_chrome_found",
      },
    );
  }

  return error;
}
