import { test, expect } from "@playwright/test";
import type { Protocol } from "devtools-protocol";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { V3 } from "../../lib/v3/v3.js";
import { v3TestConfig } from "./v3.config.js";
import { closeV3 } from "./testUtils.js";

const BLOCKED_HOST = "example.com";
const BLOCKED_URL = `https://${BLOCKED_HOST}/stagehand-domain-policy.png`;
const ALLOWED_HOST = "127.0.0.1";
const DISALLOWED_HOST = "127.0.0.2";
let localServer: Server | null = null;
let localServerPort = 0;

type InternalPage = {
  mainSession: {
    send: (method: string, params?: unknown) => Promise<unknown>;
    on: (event: string, handler: (params: unknown) => void) => void;
    off: (event: string, handler: (params: unknown) => void) => void;
  };
  goto: (
    url: string,
    options?: { waitUntil?: "load" | "domcontentloaded"; timeoutMs?: number },
  ) => Promise<unknown>;
};

function pageWithBlockedImage(): string {
  return pageWithImages([BLOCKED_URL]);
}

function pageWithImages(urls: string[]): string {
  return `data:text/html,${encodeURIComponent(
    `<html><body>${urls.map((url) => `<img src="${url}" />`).join("")}</body></html>`,
  )}`;
}

function localUrl(hostname: string, path: string): string {
  return `http://${hostname}:${localServerPort}${path}`;
}

async function waitForBlockedRequest(page: InternalPage): Promise<void> {
  const outcomes = await waitForRequestOutcomes(page, pageWithBlockedImage(), [
    BLOCKED_URL,
  ]);
  expectBlockedByClient(outcomes.get(BLOCKED_URL));
}

type RequestOutcome =
  | { type: "finished" }
  | { type: "failed"; errorText: string };

async function waitForRequestOutcomes(
  page: InternalPage,
  pageUrl: string,
  expectedUrls: string[],
): Promise<Map<string, RequestOutcome>> {
  await page.mainSession.send("Network.enable");

  return await new Promise<Map<string, RequestOutcome>>((resolve, reject) => {
    const requestUrls = new Map<string, string>();
    const expected = new Set(expectedUrls);
    const outcomes = new Map<string, RequestOutcome>();
    let settled = false;
    const timeout = setTimeout(() => {
      finish(() =>
        reject(
          new Error(
            `Timed out waiting for request outcomes: ${Array.from(expected).join(", ")}`,
          ),
        ),
      );
    }, 5000);

    const cleanup = () => {
      clearTimeout(timeout);
      page.mainSession.off("Network.requestWillBeSent", onRequest);
      page.mainSession.off("Network.loadingFinished", onLoadingFinished);
      page.mainSession.off("Network.loadingFailed", onLoadingFailed);
    };

    const finish = (settle: () => void): void => {
      if (settled) return;
      settled = true;
      cleanup();
      settle();
    };

    const recordOutcome = (url: string, outcome: RequestOutcome) => {
      if (!expected.has(url) || outcomes.has(url)) return;
      outcomes.set(url, outcome);
      if (outcomes.size === expected.size) {
        finish(() => resolve(outcomes));
      }
    };

    const onRequest = (params: unknown) => {
      const evt = params as Protocol.Network.RequestWillBeSentEvent;
      requestUrls.set(evt.requestId, String(evt.request?.url ?? ""));
    };

    const onLoadingFinished = (params: unknown) => {
      const evt = params as Protocol.Network.LoadingFinishedEvent;
      const url = requestUrls.get(evt.requestId);
      if (!url) return;
      recordOutcome(url, { type: "finished" });
    };

    const onLoadingFailed = (params: unknown) => {
      const evt = params as Protocol.Network.LoadingFailedEvent;
      const url = requestUrls.get(evt.requestId);
      if (!url) return;
      recordOutcome(url, { type: "failed", errorText: evt.errorText });
    };

    page.mainSession.on("Network.requestWillBeSent", onRequest);
    page.mainSession.on("Network.loadingFinished", onLoadingFinished);
    page.mainSession.on("Network.loadingFailed", onLoadingFailed);

    void page
      .goto(pageUrl, {
        waitUntil: "load",
        timeoutMs: 5000,
      })
      .catch((error) => {
        finish(() => reject(error));
      });
  });
}

function expectBlockedByClient(outcome: RequestOutcome | undefined): void {
  expect(outcome?.type).toBe("failed");
  expect((outcome as { errorText?: string } | undefined)?.errorText).toContain(
    "ERR_BLOCKED_BY_CLIENT",
  );
}

function expectNotBlockedByClient(outcome: RequestOutcome | undefined): void {
  expect(outcome).toBeTruthy();
  if (outcome?.type === "failed") {
    expect(outcome.errorText).not.toContain("ERR_BLOCKED_BY_CLIENT");
  }
}

test.describe("context.setDomainPolicy", () => {
  let v3: V3;

  test.beforeAll(async () => {
    localServer = createServer((_, res) => {
      res.writeHead(200, {
        "content-type": "image/svg+xml",
        "cache-control": "no-store",
      });
      res.end(
        `<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>`,
      );
    });

    await new Promise<void>((resolve) => {
      localServer?.listen(0, ALLOWED_HOST, () => {
        localServerPort = (localServer?.address() as AddressInfo).port;
        resolve();
      });
    });
  });

  test.afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      if (!localServer) {
        resolve();
        return;
      }
      localServer.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
    localServer = null;
    localServerPort = 0;
  });

  test.beforeEach(async () => {
    v3 = new V3(v3TestConfig);
    await v3.init();
  });

  test.afterEach(async () => {
    await closeV3(v3);
  });

  test("blocks matching requests on existing pages", async () => {
    const ctx = v3.context;
    const page = (await ctx.awaitActivePage()) as unknown as InternalPage;

    await ctx.setDomainPolicy({
      blockedDomains: [BLOCKED_HOST],
    });

    await waitForBlockedRequest(page);
  });

  test("applies to pages created after setting the policy", async () => {
    const ctx = v3.context;

    await ctx.setDomainPolicy({
      blockedDomains: [BLOCKED_HOST],
    });

    const page = (await ctx.newPage()) as unknown as InternalPage;

    await waitForBlockedRequest(page);
  });

  test("allows matching requests and blocks non-matching requests", async () => {
    const ctx = v3.context;
    const page = (await ctx.awaitActivePage()) as unknown as InternalPage;
    const allowedUrl = localUrl(ALLOWED_HOST, "/allowed.png");
    const disallowedUrl = localUrl(DISALLOWED_HOST, "/disallowed.png");

    await ctx.setDomainPolicy({
      allowedDomains: [ALLOWED_HOST],
    });

    const outcomes = await waitForRequestOutcomes(
      page,
      pageWithImages([allowedUrl, disallowedUrl]),
      [allowedUrl, disallowedUrl],
    );

    expectNotBlockedByClient(outcomes.get(allowedUrl));
    expectBlockedByClient(outcomes.get(disallowedUrl));
  });

  test("blocked domains take precedence over allowed domains", async () => {
    const ctx = v3.context;
    const page = (await ctx.awaitActivePage()) as unknown as InternalPage;

    await ctx.setDomainPolicy({
      allowedDomains: [ALLOWED_HOST],
      blockedDomains: [ALLOWED_HOST],
    });

    const blockedUrl = localUrl(ALLOWED_HOST, "/blocked-by-precedence.png");
    const outcomes = await waitForRequestOutcomes(
      page,
      pageWithImages([blockedUrl]),
      [blockedUrl],
    );

    expectBlockedByClient(outcomes.get(blockedUrl));
  });

  test("allowed domains apply to pages created after setting the policy", async () => {
    const ctx = v3.context;
    const disallowedUrl = localUrl(DISALLOWED_HOST, "/new-page-disallowed.png");

    await ctx.setDomainPolicy({
      allowedDomains: [ALLOWED_HOST],
    });

    const page = (await ctx.newPage()) as unknown as InternalPage;
    const outcomes = await waitForRequestOutcomes(
      page,
      pageWithImages([disallowedUrl]),
      [disallowedUrl],
    );

    expectBlockedByClient(outcomes.get(disallowedUrl));
  });
});
