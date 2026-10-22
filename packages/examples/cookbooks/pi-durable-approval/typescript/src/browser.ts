import Browserbase from "@browserbasehq/sdk";
import { browserbase, Stagehand, type Page, type StagehandBrowser } from "@browserbasehq/stagehand";
import { fingerprint, type Store } from "./state.js";

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

  async prepareForm(reference: string) {
    const page = await this.page();
    await page.goto("https://httpbin.org/forms/post");
    await page.locator('input[name="custname"]').fill("Cookbook guest");
    await page.locator('input[name="custemail"]').fill("guest@example.com");
    await page.locator('input[name="size"][value="small"]').click();
    await page.locator('textarea[name="comments"]').fill(`Durable request ${reference}`);
  }

  async formValues(): Promise<Record<string, string>> {
    const page = await this.page();
    if (new URL(await page.url()).origin !== "https://httpbin.org")
      throw new Error("Unexpected form origin");
    return page.evaluate(() => {
      const form = document.querySelector("form");
      if (!form || new URL(form.action).href !== "https://httpbin.org/post")
        throw new Error("Unexpected form action");
      const values: Record<string, string> = {};
      for (const key of new Set(new FormData(form).keys())) {
        values[key] = JSON.stringify(new FormData(form).getAll(key));
      }
      return values;
    });
  }

  async confirmation(expected: Record<string, string>) {
    const page = await this.page();
    if ((await page.url()) !== "https://httpbin.org/post")
      throw new Error("No confirmation page. Outcome unknown; do not submit again.");
    const response = JSON.parse(await page.locator("pre").innerText()) as {
      form?: Record<string, string | string[]>;
    };
    const actual = Object.fromEntries(
      Object.entries(response.form ?? {}).map(([key, value]) => [
        key,
        JSON.stringify(Array.isArray(value) ? value : [value]),
      ]),
    );
    if (fingerprint(expected) !== fingerprint(actual))
      throw new Error("Confirmation differs from the saved request. Review manually.");
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
