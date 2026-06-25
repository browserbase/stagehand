import { test, expect } from "@playwright/test";
import type { Protocol } from "devtools-protocol";
import { V3 } from "../../lib/v3/v3.js";
import { v3TestConfig } from "./v3.config.js";
import { closeV3 } from "./testUtils.js";

const BLOCKED_HOST = "example.com";
const BLOCKED_URL = `https://${BLOCKED_HOST}/stagehand-domain-policy.png`;

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
  return `data:text/html,${encodeURIComponent(
    `<html><body><img src="${BLOCKED_URL}" /></body></html>`,
  )}`;
}

async function waitForBlockedRequest(page: InternalPage): Promise<void> {
  await page.mainSession.send("Network.enable");

  await new Promise<void>((resolve, reject) => {
    const requestUrls = new Map<string, string>();
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out waiting for blocked request"));
    }, 5000);

    const cleanup = () => {
      clearTimeout(timeout);
      page.mainSession.off("Network.requestWillBeSent", onRequest);
      page.mainSession.off("Network.loadingFailed", onLoadingFailed);
    };

    const onRequest = (params: unknown) => {
      const evt = params as Protocol.Network.RequestWillBeSentEvent;
      requestUrls.set(evt.requestId, String(evt.request?.url ?? ""));
    };

    const onLoadingFailed = (params: unknown) => {
      const evt = params as Protocol.Network.LoadingFailedEvent;
      const url = requestUrls.get(evt.requestId);
      if (url !== BLOCKED_URL) return;
      try {
        expect(evt.errorText).toContain("ERR_BLOCKED_BY_CLIENT");
        cleanup();
        resolve();
      } catch (error) {
        cleanup();
        reject(error);
      }
    };

    page.mainSession.on("Network.requestWillBeSent", onRequest);
    page.mainSession.on("Network.loadingFailed", onLoadingFailed);

    void page
      .goto(pageWithBlockedImage(), {
        waitUntil: "load",
        timeoutMs: 5000,
      })
      .catch(() => {});
  });
}

test.describe("context.setDomainPolicy", () => {
  let v3: V3;

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
});
