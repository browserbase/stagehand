import Browserbase from "@browserbasehq/sdk";
import { browserbase, Stagehand, type Page, type StagehandBrowser } from "@browserbasehq/stagehand";
import { z } from "zod";
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
        model: {
          modelName: `openai/${process.env.BROWSER_MODEL ?? "gpt-6-luna"}`,
          apiKey: process.env.OPENAI_API_KEY!,
        },
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

  async receipts(url: string) {
    const page = await this.page();
    await page.goto(url);
    const schema = z.object({
      records: z
        .array(
          z.object({
            id: z.string(),
            date: z.string(),
            total: z.string(),
            currency: z.string(),
          }),
        )
        .max(50),
    });
    const result = await this.stagehand!.extract(
      "Extract visible receipt records. Copy values as shown. Return an empty list if login or verification prevents access.",
      schema,
      { page },
    );
    return schema.parse(result.data).records;
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
