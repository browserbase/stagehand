/* oxlint-disable no-console -- Browser-side console calls are part of the behavior under test. */
import { afterEach, describe, expect, it } from "vitest";
import type { PageCDPEvent, Response, Stagehand } from "../../src/index.js";
import {
  closeStagehand,
  createStagehand,
  firstPage,
  startFixtureServer,
  type FixtureServer,
} from "./_support.js";

type ExceptionDetails = {
  text?: string;
  exception?: { description?: string };
};

function describeException(event: PageCDPEvent): string {
  const details = event.params.exceptionDetails as ExceptionDetails | undefined;
  return details?.exception?.description ?? details?.text ?? "";
}

describe('page.on("pageerror")', () => {
  let stagehand: Stagehand | undefined;
  let fixture: FixtureServer | undefined;

  afterEach(async () => {
    try {
      await closeStagehand(stagehand);
    } finally {
      await fixture?.close();
    }
    stagehand = undefined;
    fixture = undefined;
  });

  it("delivers uncaught exceptions from the main frame and a cross-site OOPIF until unsubscribed", async () => {
    fixture = await startFixtureServer({
      "/": `<!doctype html><body><script>
        window.throwInChild = (message) =>
          document.querySelector('iframe').contentWindow.postMessage(message, '*');
      </script></body>`,
      "/child": `<!doctype html><script>
        addEventListener('message', (event) => {
          if (event.source === parent) throw new Error(event.data);
        });
      </script>`,
    });
    const childUrl = fixture.url.replace("127.0.0.1", "child.test") + "child";
    stagehand = await createStagehand({
      browser: {
        args: [
          "--host-resolver-rules=MAP child.test 127.0.0.1",
          "--site-per-process",
          "--no-proxy-server",
        ],
      },
    });
    const page = await firstPage(stagehand);
    await page.goto(fixture.url, { waitUntil: "load" });

    const events: PageCDPEvent[] = [];
    const subscription = await page.on("pageerror", (event) => events.push(event));

    await page.evaluate(() => {
      setTimeout(() => {
        throw new Error("main frame boom");
      });
      void Promise.reject(new Error("main frame rejection"));
    });
    await expect
      .poll(() => events.map(describeException).sort(), { timeout: 10_000 })
      .toEqual([
        expect.stringContaining("main frame boom"),
        expect.stringContaining("main frame rejection"),
      ]);
    const mainEvent = events.find((event) => describeException(event).includes("main frame boom"));
    expect(mainEvent).toMatchObject({ method: "Runtime.exceptionThrown" });
    expect(mainEvent?.params.timestamp).toEqual(expect.any(Number));

    await page.evaluate((src) => {
      const iframe = document.createElement("iframe");
      iframe.src = src;
      document.body.append(iframe);
      return new Promise<void>((resolve) => iframe.addEventListener("load", () => resolve()));
    }, childUrl);
    // The OOPIF session is adopted asynchronously after the frame loads; keep asking the child
    // to throw until its exception arrives through the adopted session.
    let attempt = 0;
    await expect
      .poll(
        async () => {
          await page.evaluate((message) => {
            (window as unknown as { throwInChild(message: string): void }).throwInChild(message);
          }, `child frame boom ${++attempt}`);
          return events.find((event) => describeException(event).includes("child frame boom"));
        },
        { timeout: 15_000, interval: 200 },
      )
      .toBeDefined();
    const childEvent = events.find((event) =>
      describeException(event).includes("child frame boom"),
    )!;
    expect(childEvent.method).toBe("Runtime.exceptionThrown");
    expect(childEvent.sessionId).not.toBe(mainEvent!.sessionId);
    expect(childEvent.targetId).not.toBe(mainEvent!.targetId);
    expect(childEvent.pageId).toBe(mainEvent!.pageId);

    // A second, still-active subscription proves the exception below is really delivered.
    const controlEvents: PageCDPEvent[] = [];
    const control = await page.on("pageerror", (event) => controlEvents.push(event));
    await subscription.unsubscribe();
    const countAfterUnsubscribe = events.length;
    await page.evaluate(() => {
      setTimeout(() => {
        throw new Error("after unsubscribe");
      });
    });
    await expect
      .poll(() => controlEvents.map(describeException).join("\n"), { timeout: 10_000 })
      .toContain("after unsubscribe");
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(events).toHaveLength(countAfterUnsubscribe);
    await control.unsubscribe();
  }, 60_000);

  it("keeps console, pageerror and response callbacks independent on one page", async () => {
    fixture = await startFixtureServer({
      "/": "<!doctype html><title>Page event coexistence</title>",
      "/data": { headers: { "content-type": "application/json" }, body: '{"ok":true}' },
    });
    stagehand = await createStagehand();
    const page = await firstPage(stagehand);
    await page.goto(fixture.url, { waitUntil: "load" });

    const consoleEvents: PageCDPEvent[] = [];
    const legacyConsoleEvents: PageCDPEvent[] = [];
    const pageErrors: PageCDPEvent[] = [];
    const responses: Response[] = [];
    const consoleSubscription = await page.onConsole((event) => consoleEvents.push(event));
    const legacyConsoleSubscription = await page.on("console", (event) =>
      legacyConsoleEvents.push(event),
    );
    const pageErrorSubscription = await page.on("pageerror", (event) => pageErrors.push(event));
    const responseSubscription = await page.onResponse((response) => responses.push(response));
    const logged = (text: string) =>
      consoleEvents.some((event) => JSON.stringify(event.params).includes(text));
    const dataResponses = () => responses.filter((response) => response.url().includes("/data"));

    try {
      await page.evaluate(() => {
        console.log("coexist log");
        setTimeout(() => {
          throw new Error("coexist boom");
        });
        return fetch("/data").then((response) => response.text());
      });
      await expect
        .poll(() => pageErrors.map(describeException).join("\n"), { timeout: 10_000 })
        .toContain("coexist boom");
      await expect.poll(() => logged("coexist log"), { timeout: 10_000 }).toBe(true);
      await expect.poll(() => dataResponses().length, { timeout: 10_000 }).toBe(1);
      expect(await dataResponses()[0]!.json()).toEqual({ ok: true });

      expect(pageErrors).toHaveLength(1);
      expect(pageErrors[0]!.method).toBe("Runtime.exceptionThrown");
      expect(consoleEvents.every((event) => event.method === "Runtime.consoleAPICalled")).toBe(
        true,
      );
      expect(consoleEvents.some((event) => describeException(event).includes("boom"))).toBe(false);
      expect(legacyConsoleEvents).toEqual(consoleEvents);

      // Removing the pageerror subscription leaves console and response delivery intact.
      await pageErrorSubscription.unsubscribe();
      await page.evaluate(() => {
        setTimeout(() => {
          throw new Error("unobserved boom");
        });
        setTimeout(() => console.log("after unobserved boom"), 50);
        return fetch("/data?again").then((response) => response.text());
      });
      await expect.poll(() => logged("after unobserved boom"), { timeout: 10_000 }).toBe(true);
      await expect.poll(() => dataResponses().length, { timeout: 10_000 }).toBe(2);
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(pageErrors).toHaveLength(1);
    } finally {
      await consoleSubscription.unsubscribe();
      await legacyConsoleSubscription.unsubscribe();
      await pageErrorSubscription.unsubscribe();
      await responseSubscription.unsubscribe();
    }
  }, 60_000);
});
