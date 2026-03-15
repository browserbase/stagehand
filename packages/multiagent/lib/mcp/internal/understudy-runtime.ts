import { V3 } from "@browserbasehq/stagehand";
import type { LoadState, PageSnapshotOptions } from "@browserbasehq/stagehand";
import type { Page } from "@browserbasehq/stagehand";

export interface UnderstudyRuntimeOptions {
  cdpUrl: string;
}

export interface UnderstudyGotoInput {
  url: string;
  waitUntil?: LoadState;
  timeoutMs?: number;
}

export interface UnderstudyScreenshotInput {
  type?: "png" | "jpeg";
  fullPage?: boolean;
  quality?: number;
  path?: string;
  omitBackground?: boolean;
  timeoutMs?: number;
}

export interface UnderstudySnapshotInput extends PageSnapshotOptions {}

export interface UnderstudyClickInput {
  x: number;
  y: number;
  button?: "left" | "right" | "middle";
  clickCount?: number;
  returnXpath?: boolean;
}

export interface UnderstudyTypeInput {
  text: string;
  delay?: number;
  withMistakes?: boolean;
}

export interface UnderstudyKeyPressInput {
  key: string;
  delay?: number;
}

export interface UnderstudyWaitForSelectorInput {
  selector: string;
  state?: "attached" | "detached" | "visible" | "hidden";
  timeout?: number;
  pierceShadow?: boolean;
}

export interface UnderstudyScrollInput {
  x: number;
  y: number;
  deltaX: number;
  deltaY: number;
  returnXpath?: boolean;
}

export class UnderstudyRuntime {
  private v3: V3 | null = null;

  constructor(private readonly options: UnderstudyRuntimeOptions) {}

  async start(): Promise<void> {
    if (this.v3) {
      return;
    }

    this.v3 = new V3({
      env: "LOCAL",
      verbose: 0,
      localBrowserLaunchOptions: {
        cdpUrl: this.options.cdpUrl,
      },
    });
    await this.v3.init();
  }

  async stop(): Promise<void> {
    await this.v3?.close();
    this.v3 = null;
  }

  async getPage(): Promise<Page> {
    await this.start();
    const page = await this.v3!.context.awaitActivePage();
    this.v3!.context.setActivePage(page);
    return page;
  }

  async newPage(url = "about:blank"): Promise<Page> {
    await this.start();
    const page = await this.v3!.context.newPage(url);
    this.v3!.context.setActivePage(page);
    return page;
  }

  async goto(input: UnderstudyGotoInput): Promise<{
    url: string;
    title: string;
  }> {
    const page = await this.getPage();
    await page.goto(input.url, {
      waitUntil: input.waitUntil,
      timeoutMs: input.timeoutMs,
    });
    return {
      url: page.url(),
      title: await page.title(),
    };
  }

  async getUrl(): Promise<string> {
    return (await this.getPage()).url();
  }

  async getTitle(): Promise<string> {
    return await (await this.getPage()).title();
  }

  async screenshot(input: UnderstudyScreenshotInput): Promise<{
    mimeType: string;
    base64: string;
    path?: string;
  }> {
    const page = await this.getPage();
    const type = input.type ?? "png";
    const buffer = await page.screenshot({
      type,
      fullPage: input.fullPage,
      quality: input.quality,
      path: input.path,
      omitBackground: input.omitBackground,
      timeout: input.timeoutMs,
    });

    return {
      mimeType: type === "jpeg" ? "image/jpeg" : "image/png",
      base64: buffer.toString("base64"),
      path: input.path,
    };
  }

  async snapshot(input: UnderstudySnapshotInput): Promise<{
    formattedTree: string;
    xpathMap: Record<string, string>;
    urlMap: Record<string, string>;
  }> {
    const snapshot = await (await this.getPage()).snapshot(input);
    return {
      formattedTree: snapshot.formattedTree,
      xpathMap: snapshot.xpathMap,
      urlMap: snapshot.urlMap,
    };
  }

  async click(input: UnderstudyClickInput): Promise<{ xpath?: string }> {
    const xpath = await (await this.getPage()).click(input.x, input.y, {
      button: input.button,
      clickCount: input.clickCount,
      returnXpath: input.returnXpath,
    });
    return xpath ? { xpath } : {};
  }

  async type(input: UnderstudyTypeInput): Promise<void> {
    await (await this.getPage()).type(input.text, {
      delay: input.delay,
      withMistakes: input.withMistakes,
    });
  }

  async keyPress(input: UnderstudyKeyPressInput): Promise<void> {
    await (await this.getPage()).keyPress(input.key, {
      delay: input.delay,
    });
  }

  async waitForSelector(
    input: UnderstudyWaitForSelectorInput,
  ): Promise<boolean> {
    return await (await this.getPage()).waitForSelector(input.selector, {
      state: input.state,
      timeout: input.timeout,
      pierceShadow: input.pierceShadow,
    });
  }

  async waitForTimeout(ms: number): Promise<void> {
    await (await this.getPage()).waitForTimeout(ms);
  }

  async scroll(input: UnderstudyScrollInput): Promise<{ xpath?: string }> {
    const xpath = await (await this.getPage()).scroll(
      input.x,
      input.y,
      input.deltaX,
      input.deltaY,
      {
        returnXpath: input.returnXpath,
      },
    );
    return xpath ? { xpath } : {};
  }
}
