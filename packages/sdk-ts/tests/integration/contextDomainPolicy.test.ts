import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Page, Stagehand } from "../../src/index.js";
import { startDomainPolicyFixture, observeDomainPolicyRequests } from "./_domainPolicy.js";
import {
  closeStagehand,
  createStagehand,
  firstPage,
  startFixtureServer,
  type FixtureServer,
} from "./_support.js";

async function imageLoads(page: Page, url: string): Promise<boolean> {
  await page.goto(`data:text/html,${encodeURIComponent(`<img id="probe" src="${url}">`)}`);
  return page.evaluate(async () => {
    const image = document.querySelector<HTMLImageElement>("#probe")!;
    if (image.complete) return image.naturalWidth > 0;
    return new Promise<boolean>((resolve) => {
      image.addEventListener("load", () => resolve(true), { once: true });
      image.addEventListener("error", () => resolve(false), { once: true });
    });
  });
}

describe("context.setDomainPolicy", () => {
  let fixture: FixtureServer;
  let stagehand: Stagehand;
  let allowedUrl: string;
  let alternateHostUrl: string;

  beforeEach(async () => {
    fixture = await startFixtureServer({
      "/pixel.svg": {
        headers: { "content-type": "image/svg+xml" },
        body: `<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect width="1" height="1"/></svg>`,
      },
      "/popup": `<h1>popup</h1>`,
    });
    allowedUrl = new URL("/pixel.svg", fixture.url).href;
    alternateHostUrl = allowedUrl.replace("127.0.0.1", "alternate.test");
    stagehand = await createStagehand({
      browser: {
        args: ["--host-resolver-rules=MAP alternate.test 127.0.0.1"],
      },
    });
  });

  afterEach(async () => {
    await closeStagehand(stagehand);
    await fixture.close();
  });

  it("blocks matching requests on existing pages", async () => {
    const page = await firstPage(stagehand);
    await stagehand.browser.context.setDomainPolicy({ blockedDomains: ["127.0.0.1"] });

    await expect(imageLoads(page, allowedUrl)).resolves.toBe(false);
  });

  it("applies to pages created after setting the policy", async () => {
    await stagehand.browser.context.setDomainPolicy({ blockedDomains: ["127.0.0.1"] });
    const page = await stagehand.browser.context.newPage();

    await expect(imageLoads(page, allowedUrl)).resolves.toBe(false);
  });

  it("allows matching requests and blocks non-matching requests", async () => {
    const page = await firstPage(stagehand);
    // Prove the alternate hostname reaches this fixture before policy is applied,
    // so the later chrome-error can only be attributed to domain policy.
    const initialResponse = await page.goto(alternateHostUrl);
    expect(initialResponse?.ok()).toBe(true);
    await stagehand.browser.context.setDomainPolicy({ allowedDomains: ["127.0.0.1"] });

    const allowedResponse = await page.goto(allowedUrl);
    expect(allowedResponse?.ok()).toBe(true);
    const blockedPage = await stagehand.browser.context.newPage();
    await blockedPage.goto(alternateHostUrl);
    await expect(blockedPage.url()).resolves.toMatch(/^chrome-error:/);
  });

  it("blocked domains take precedence over allowed domains", async () => {
    const page = await firstPage(stagehand);
    await stagehand.browser.context.setDomainPolicy({
      allowedDomains: ["127.0.0.1"],
      blockedDomains: ["127.0.0.1"],
    });

    await expect(imageLoads(page, allowedUrl)).resolves.toBe(false);
  });

  it("allowed domains apply to pages created afterward", async () => {
    await stagehand.browser.context.setDomainPolicy({ allowedDomains: ["127.0.0.1"] });
    const page = await stagehand.browser.context.newPage();

    const response = await page.goto(allowedUrl);
    expect(response?.ok()).toBe(true);
  });

  it("does not retain a popup targeting a blocked domain", async () => {
    const page = await firstPage(stagehand);
    const popupUrl = new URL("/popup", fixture.url).href;
    await stagehand.browser.context.setDomainPolicy({ blockedDomains: ["127.0.0.1"] });
    await page.goto(
      `data:text/html,${encodeURIComponent(`<button id="open" onclick="window.__blockedPopup = window.open('${popupUrl}')">open</button>`)}`,
    );
    const knownPageIds = new Set(
      (await stagehand.browser.context.pages()).map((candidate) => candidate.pageId),
    );
    await page.locator("#open").click();

    await expect
      .poll(
        () =>
          page.evaluate(
            () =>
              (window as typeof window & { __blockedPopup?: Window }).__blockedPopup?.closed ??
              false,
          ),
        { timeout: 5_000, interval: 50 },
      )
      .toBe(true);
    await expect
      .poll(
        async () =>
          (await stagehand.browser.context.pages()).every((candidate) =>
            knownPageIds.has(candidate.pageId),
          ),
        { timeout: 5_000, interval: 50 },
      )
      .toBe(true);
  });
});

describe("DNR domain policy regressions", () => {
  let fixture: Awaited<ReturnType<typeof startDomainPolicyFixture>>;
  let stagehand: Stagehand;
  let page: Page;
  let downloadsPath: string | undefined;
  let observer: Awaited<ReturnType<typeof observeDomainPolicyRequests>> | undefined;

  beforeEach(async () => {
    fixture = await startDomainPolicyFixture();
    stagehand = await createStagehand({
      browser: {
        // Route test names (including trailing dots) to the fixture, and force OOPIFs.
        args: ["--host-resolver-rules=MAP * 127.0.0.1", "--site-per-process"],
      },
      model: {
        generate: async (params) => {
          const prompt = params.messages
            .flatMap(({ content }) => (Array.isArray(content) ? content : [content]))
            .filter((part) => part.type === "text")
            .map((part) => part.text)
            .join("\n");
          const elementId = prompt
            .split("\n")
            .find((line) => line.includes("Continue") && /\[\d+-\d+\]/.test(line))
            ?.match(/\[(\d+-\d+)\]/)?.[1];
          expect(elementId).toBeDefined();
          return {
            role: "assistant",
            content: { type: "text", text: "Click Continue" },
            outputFormat: "json_schema",
            structuredContent: {
              action: {
                elementId: elementId!,
                description: "Continue",
                method: "click",
                arguments: [],
              },
              twoStep: false,
            },
          };
        },
      },
    });
    page = await firstPage(stagehand);
    await page.goto(new URL("/driver", fixture.url).href);
  });

  afterEach(async () => {
    observer?.close();
    observer = undefined;
    await closeStagehand(stagehand);
    await fixture?.close();
    if (downloadsPath) await rm(downloadsPath, { recursive: true, force: true });
    downloadsPath = undefined;
  });

  async function watch() {
    observer ??= await observeDomainPolicyRequests(stagehand, page);
    return observer;
  }

  async function navigateFromPage(kind: string, target: string) {
    await page.goto(new URL("/driver", fixture.url).href);
    if (kind === "goto") {
      await page.goto(target);
      return;
    }
    if (kind === "redirect") {
      const redirect = new URL("/redirect", fixture.url);
      redirect.searchParams.set("to", target);
      await page.goto(redirect.href);
      return;
    }
    await page.evaluate(
      ({ kind, target }) => {
        // Return the evaluation result before navigation destroys the execution context.
        setTimeout(() => {
          if (kind === "location") location.href = target;
          if (kind === "link") {
            const link = document.createElement("a");
            link.href = target;
            document.body.append(link);
            link.click();
          }
          if (kind === "meta") {
            const meta = document.createElement("meta");
            meta.httpEquiv = "refresh";
            meta.content = "0;url=" + target;
            document.head.append(meta);
          }
          if (kind === "form") {
            const form = document.createElement("form");
            form.method = "POST";
            form.action = target;
            const input = document.createElement("input");
            input.name = "payload";
            input.value = "from-page";
            form.append(input);
            document.body.append(form);
            form.submit();
          }
        }, 0);
      },
      { kind, target },
    );
  }

  it.each(["goto", "location", "link", "meta", "redirect", "form"])(
    "blocks credentialed navigation via %s before any request reaches the server",
    async (kind) => {
      const control = fixture.target("control", "blocked.test", true);
      await navigateFromPage(kind, control);
      await expect.poll(() => fixture.received(control).length).toBe(1);
      await expect.poll(() => page.title()).toBe("destination");
      expect(fixture.received(control)[0].method).toBe(kind === "form" ? "POST" : "GET");
      if (kind === "form") expect(fixture.received(control)[0].body).toBe("payload=from-page");

      await stagehand.browser.context.setDomainPolicy({ blockedDomains: ["blocked.test"] });
      const blocked = fixture.target("blocked", "blocked.test", true);
      await navigateFromPage(kind, blocked);
      await expect.poll(() => page.url()).toMatch(/^chrome-error:/);
      expect(fixture.received(blocked)).toEqual([]);
    },
  );

  // Chrome rejects repeated trailing dots before networking on some versions;
  // the compiler tests cover those spellings independently of DNS/URL validation.
  it.each(["blocked.test.", "sub.blocked.test."])(
    "blocks credentials and trailing dots for %s",
    async (hostname) => {
      const control = fixture.target("control", hostname, true);
      await page.goto(control);
      await expect.poll(() => fixture.received(control).length).toBe(1);
      await expect.poll(() => page.title()).toBe("destination");
      expect(fixture.received(control)).toHaveLength(1);
      await stagehand.browser.context.setDomainPolicy({
        blockedDomains: [hostname.startsWith("sub.") ? "*.blocked.test" : "blocked.test"],
      });
      const blocked = fixture.target("blocked", hostname, true);
      await page.goto(blocked);
      await expect(page.url()).resolves.toMatch(/^chrome-error:/);
      expect(fixture.received(blocked)).toEqual([]);
    },
  );

  it("blocks a 307-redirected beacon without delivering its POST body", async () => {
    const { events } = await watch();
    const beacon = async (target: string) => {
      const redirect = new URL("/redirect", fixture.url);
      redirect.searchParams.set("code", "307");
      redirect.searchParams.set("to", target);
      expect(
        await page.evaluate((url) => navigator.sendBeacon(url, "beacon-payload"), redirect.href),
      ).toBe(true);
      return redirect.href;
    };
    const control = fixture.target("control", "blocked.test", true);
    await beacon(control);
    await expect.poll(() => fixture.received(control).length).toBe(1);
    expect(fixture.received(control)[0]).toMatchObject({ method: "POST", body: "beacon-payload" });

    await stagehand.browser.context.setDomainPolicy({ blockedDomains: ["blocked.test"] });
    const blocked = fixture.target("blocked", "blocked.test", true);
    const redirect = await beacon(blocked);
    await expect
      .poll(() => {
        const ids = events
          .filter((event) => event.params.request?.url === redirect)
          .map((event) => event.params.requestId);
        return events.find(
          (event) =>
            event.method === "Network.loadingFailed" && ids.includes(event.params.requestId),
        );
      })
      .toBeDefined();
    expect(fixture.received(redirect)).toHaveLength(1);
    expect(fixture.received(blocked)).toEqual([]);
    await expect(page.title()).resolves.toBe("driver");
  });

  async function workerFetch(kind: string, url: string) {
    return page.evaluate(
      async ({ kind, url }) => {
        if (kind === "service") {
          await navigator.serviceWorker.register("/service-worker.js");
          const registration = await navigator.serviceWorker.ready;
          const channel = new MessageChannel();
          return new Promise<string>((resolve) => {
            channel.port1.onmessage = (event) => {
              channel.port1.close();
              resolve(event.data);
            };
            registration.active!.postMessage(url, [channel.port2]);
          });
        }
        if (kind === "shared") {
          const worker = new SharedWorker("/shared-worker.js");
          return new Promise<string>((resolve, reject) => {
            worker.onerror = () => reject(new Error("SharedWorker failed to start"));
            worker.port.onmessage = (event) => {
              worker.port.close();
              resolve(event.data);
            };
            worker.port.postMessage(url);
          });
        }
        const worker = new Worker("/worker.js");
        return new Promise<string>((resolve, reject) => {
          worker.onerror = () => {
            worker.terminate();
            reject(new Error("Worker failed to start"));
          };
          worker.onmessage = (event) => {
            worker.terminate();
            resolve(event.data);
          };
          worker.postMessage(url);
        });
      },
      { kind, url },
    );
  }

  it.each(["dedicated", "shared", "service"])("blocks requests from a %s worker", async (kind) => {
    const control = fixture.target("control");
    expect(await workerFetch(kind, control)).toBe("loaded");
    expect(fixture.received(control)).toHaveLength(1);
    await stagehand.browser.context.setDomainPolicy({ blockedDomains: ["blocked.test"] });
    const blocked = fixture.target("blocked");
    expect(await workerFetch(kind, blocked)).toBe("blocked");
    expect(fixture.received(blocked)).toEqual([]);
    await stagehand.browser.context.setDomainPolicy(null);
    const cleared = fixture.target("cleared");
    expect(await workerFetch(kind, cleared)).toBe("loaded");
    expect(fixture.received(cleared)).toHaveLength(1);
  });

  it.each(["prefetch", "prerender"])(
    "blocks network loads initiated by a %s speculation rule",
    async (action) => {
      const { cdp, sessionId, events } = await watch();
      await cdp.sendCommand("Preload.enable", {}, sessionId);
      const speculate = (url: string) =>
        page.evaluate(
          ({ action, url }) => {
            const rules = document.createElement("script");
            rules.type = "speculationrules";
            rules.textContent = JSON.stringify({
              [action]: [{ source: "list", urls: [url], eagerness: "immediate" }],
            });
            document.head.append(rules);
          },
          { action, url },
        );

      // Same-origin requests avoid Chrome's cross-site speculation eligibility rules.
      const control = fixture.target("control", "127.0.0.1");
      await speculate(control);
      await expect.poll(() => fixture.received(control).length, { timeout: 10_000 }).toBe(1);
      expect(fixture.received(control)[0].purpose).toContain(
        action === "prerender" ? "prerender" : "prefetch",
      );

      await page.goto(new URL("/driver?phase=blocked", fixture.url).href);
      await stagehand.browser.context.setDomainPolicy({ blockedDomains: ["127.0.0.1"] });
      const blocked = fixture.target("blocked", "127.0.0.1");
      await speculate(blocked);
      // Some Chrome versions disable full prerendering under CDP while still
      // fetching its document. Require a network failure, not just the unrelated
      // PrerenderingDisabledByDevTools status, before asserting no server traffic.
      await expect
        .poll(
          () =>
            events.find(
              (event) =>
                event.params.key?.url === blocked &&
                event.params.status === "Failure" &&
                /^(PrefetchFailedNetError|BlockedByClient|PrerenderFailedDuringPrefetch|NavigationRequestNetworkError)$/.test(
                  event.params.prefetchStatus ?? event.params.prerenderStatus ?? "",
                ),
            ),
          { timeout: 10_000 },
        )
        .toBeDefined();
      expect(fixture.received(blocked)).toEqual([]);
    },
  );

  it("blocks Background Fetch requests made by Chrome", async () => {
    const { cdp } = await watch();
    downloadsPath = await mkdtemp(path.join(tmpdir(), "stagehand-policy-downloads-"));
    await cdp.sendCommand("Browser.setDownloadBehavior", {
      behavior: "allow",
      downloadPath: downloadsPath,
    });
    await cdp.sendCommand("Browser.grantPermissions", {
      origin: new URL(fixture.url).origin,
      permissions: ["backgroundFetch"],
    });
    await page.evaluate(async () => {
      await navigator.serviceWorker.register("/service-worker.js");
      await navigator.serviceWorker.ready;
    });
    const backgroundFetch = async (url: string, id: string) => {
      await page.evaluate(
        async ({ url, id }) => {
          type Registration = EventTarget & { result: string; failureReason: string };
          const registration = (await navigator.serviceWorker
            .ready) as ServiceWorkerRegistration & {
            backgroundFetch: {
              fetch(id: string, urls: string[], options: { title: string }): Promise<Registration>;
            };
          };
          const fetch = await registration.backgroundFetch.fetch(id, [url], {
            title: "Domain policy test",
          });
          (
            window as typeof window & { policyBackgroundFetch: Registration }
          ).policyBackgroundFetch = fetch;
        },
        { url, id },
      );
      await expect
        .poll(
          () =>
            page.evaluate(
              () =>
                (window as typeof window & { policyBackgroundFetch: { result: string } })
                  .policyBackgroundFetch.result,
            ),
          { timeout: 15_000 },
        )
        .not.toBe("");
      return page.evaluate(() => {
        const fetch = (
          window as typeof window & {
            policyBackgroundFetch: { result: string; failureReason: string };
          }
        ).policyBackgroundFetch;
        return { result: fetch.result, failureReason: fetch.failureReason };
      });
    };
    const control = fixture.target("control", "127.0.0.1");
    expect(await backgroundFetch(control, "control")).toMatchObject({ result: "success" });
    expect(fixture.received(control)).toHaveLength(1);
    await stagehand.browser.context.setDomainPolicy({ blockedDomains: ["127.0.0.1"] });
    const blocked = fixture.target("blocked", "127.0.0.1");
    const result = await backgroundFetch(blocked, "blocked");
    expect(result.result).toBe("failure");
    // Chrome versions report a blocked download as either a network error or
    // an unusable response status; the server log proves no request was delivered.
    expect(result.failureReason).toMatch(/^(fetch-error|bad-status)$/);
    expect(fixture.received(blocked)).toEqual([]);
  });

  it("blocks cross-site iframe requests after a string act", async () => {
    const result = await stagehand.act("Click Continue", { page });
    expect(result.data.success).toBe(true);
    // This exercises the reported auto-attachment gap without depending on that bug
    // remaining present: the policy must hold whether the child is attached or not.
    const frameUrl = new URL("/frame", fixture.url);
    frameUrl.hostname = "frame.test";
    await page.evaluate(
      (url) =>
        new Promise<void>((resolve) => {
          const frame = document.createElement("iframe");
          frame.id = "cross-site-frame";
          frame.onload = () => resolve();
          frame.src = url;
          document.body.append(frame);
        }),
      frameUrl.href,
    );
    const frameFetch = (url: string) =>
      page.evaluate(
        (url) =>
          new Promise<string>((resolve) => {
            const frame = document.querySelector<HTMLIFrameElement>("#cross-site-frame")!;
            const listener = (event: MessageEvent) => {
              if (event.source !== frame.contentWindow) return;
              window.removeEventListener("message", listener);
              resolve(event.data);
            };
            window.addEventListener("message", listener);
            frame.contentWindow!.postMessage(url, "*");
          }),
        url,
      );
    const control = fixture.target("control");
    expect(await frameFetch(control)).toBe("loaded");
    expect(fixture.received(control)).toHaveLength(1);
    await stagehand.browser.context.setDomainPolicy({ blockedDomains: ["blocked.test"] });
    const blocked = fixture.target("blocked");
    expect(await frameFetch(blocked)).toBe("blocked");
    expect(fixture.received(blocked)).toEqual([]);
  });

  it("replaces and clears policy at runtime without retaining old rules", async () => {
    const fetchFromPage = (url: string) =>
      page.evaluate(async (url) => {
        try {
          await fetch(url);
          return true;
        } catch {
          return false;
        }
      }, url);
    await stagehand.browser.context.setDomainPolicy({ blockedDomains: ["blocked.test"] });
    const first = fixture.target("first");
    expect(await fetchFromPage(first)).toBe(false);
    expect(fixture.received(first)).toEqual([]);

    await stagehand.browser.context.setDomainPolicy({ blockedDomains: ["other.test"] });
    const released = fixture.target("released");
    expect(await fetchFromPage(released)).toBe(true);
    expect(fixture.received(released)).toHaveLength(1);
    const replaced = fixture.target("replaced", "other.test");
    expect(await fetchFromPage(replaced)).toBe(false);
    expect(fixture.received(replaced)).toEqual([]);

    await stagehand.browser.context.setDomainPolicy(null);
    const cleared = fixture.target("cleared", "other.test");
    expect(await fetchFromPage(cleared)).toBe(true);
    expect(fixture.received(cleared)).toHaveLength(1);
  });
});
