import Browserbase from "@browserbasehq/sdk";
import { browserbase, Stagehand, type Page, type StagehandBrowser } from "@browserbasehq/stagehand";
import type { Store } from "./state.js";

export class Browser {
  private stagehand?: Stagehand;
  private browser?: StagehandBrowser;
  private get bb() {
    return new Browserbase({ apiKey: process.env.BROWSERBASE_API_KEY });
  }
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private store: Store) {}

  serial<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.queue.then(operation);
    this.queue = next.catch(() => {});
    return next;
  }

  async page(): Promise<Page> {
    if (!this.browser) {
      const state = await this.store.read();
      if (state.browser) {
        // An expired session cannot reconstruct an in-flight OTP or an uncertain submission.
        this.browser = await browserbase.connect({
          apiKey: process.env.BROWSERBASE_API_KEY!,
          sessionId: state.browser.sessionId,
        });
      } else {
        this.browser = await browserbase.launch({
          apiKey: process.env.BROWSERBASE_API_KEY!,
          keepAlive: true,
          // SDK 2.22 names session lifetime api_timeout; it sends timeout to the API.
          api_timeout: 1800,
          browserSettings: { solveCaptchas: false },
        });
        const sessionId = this.browser.sessionId!;
        await this.store.update((draft) => {
          draft.browser = { sessionId, expiresAt: Date.now() + 1_800_000 };
        });
      }
      console.log(`Session: https://www.browserbase.com/sessions/${this.browser.sessionId}`);
    }
    if (!this.stagehand) {
      this.stagehand = await Stagehand.create({
        browser: this.browser,
      });
    }
    const page = await this.browser.context.activePage();
    if (!page) throw new Error("The browser has no active page");
    return page;
  }

  async liveLink() {
    const page = await this.page();
    const live = await this.bb.sessions.debug(this.browser!.sessionId!);
    const target = live.pages.find((entry) => entry.id === page.pageId);
    if (!target) throw new Error("Active tab has no Live View URL. Retry status.");
    console.log(`Live View: ${target.debuggerFullscreenUrl}`);
  }

  private targets?: { pageId: string; url: string; xpathMap: Record<string, string> };

  async snapshot() {
    const page = await this.page();
    const snapshot = await page.snapshot({ includeIframes: true });
    const url = await page.url();
    this.targets = { pageId: page.pageId, url, xpathMap: snapshot.xpathMap };
    return JSON.stringify({
      url,
      tree: snapshot.formattedTree.slice(0, 20000),
      truncated: snapshot.formattedTree.length > 20000,
    });
  }

  async run(id: string) {
    const page = await this.page();
    const targets = this.targets;
    this.targets = undefined;
    if (!targets || targets.pageId !== page.pageId || targets.url !== (await page.url()))
      throw new Error("Take a fresh snapshot of this tab before run.");
    const xpath = targets.xpathMap[id];
    if (!xpath) throw new Error("Unknown snapshot ID. Take a fresh snapshot.");
    const state = await this.store.read();
    if (!state.loginStarted) throw new Error("Use begin_login first.");
    if (state.loginActionAttempted)
      throw new Error(
        "Login action already attempted. Inspect the result or hand off; do not send another code.",
      );
    const url = new URL(await page.url());
    if (!isNotion(url) || !url.pathname.includes("login"))
      throw new Error("run is restricted to the Notion login page.");
    await this.store.update((draft) => {
      draft.loginActionAttempted = true;
    });
    await page.locator(`xpath=${xpath}`).click();
    return "Login action attempted. Take a fresh snapshot; hand off manual verification.";
  }

  async screenshot() {
    const page = await this.page();
    return Buffer.from(await page.screenshot({ type: "png" })).toString("base64");
  }

  async workspace() {
    const page = await this.page();
    const url = new URL(await page.url());
    if (
      !isNotion(url) ||
      url.pathname.includes("login") ||
      !(await page.locator(".notion-sidebar").isVisible())
    )
      throw new Error("No authenticated Notion sidebar found. Inspect or hand off again.");
    const pages = await page.evaluate(() => {
      const sidebar = document.querySelector(".notion-sidebar");
      const seen = new Set<string>();
      return Array.from(sidebar?.querySelectorAll<HTMLAnchorElement>("a[href]") ?? [])
        .filter(
          (link) =>
            link.getClientRects().length > 0 &&
            link.innerText.trim() &&
            link.origin === location.origin &&
            !seen.has(link.href) &&
            !!seen.add(link.href),
        )
        .slice(0, 20)
        .map((link) => ({ title: link.innerText.trim(), url: link.href }));
    });
    if (!pages.length)
      throw new Error("No visible workspace links found. Inspect or hand off again.");
    return { url: url.href, title: await page.title(), pages };
  }

  async stop(release = false) {
    try {
      await this.stagehand?.close();
    } finally {
      this.stagehand = undefined;
      if (release) {
        const binding = (await this.store.read()).browser;
        if (binding)
          await this.bb.sessions.update(binding.sessionId, { status: "REQUEST_RELEASE" });
      }
    }
    // In the pinned 4.3.0 SDK, browser.close releases even a keep-alive session.
  }
}

function isNotion(url: URL) {
  return ["notion.so", "notion.com"].some(
    (host) => url.hostname === host || url.hostname.endsWith(`.${host}`),
  );
}
