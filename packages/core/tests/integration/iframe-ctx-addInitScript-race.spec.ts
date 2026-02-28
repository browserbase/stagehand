import { expect, test } from "@playwright/test";
import { V3 } from "../../lib/v3/v3.js";
import { v3TestConfig } from "./v3.config.js";
import type { V3Context } from "../../lib/v3/understudy/context.js";
import type { Page } from "../../lib/v3/understudy/page.js";

const DEFAULT_INIT_SCRIPT_DELAY_MS = 250;
const INIT_SCRIPT_DELAY_MS = (() => {
  const rawValue = process.env.IFRAME_INIT_SCRIPT_SEND_DELAY_MS;
  if (rawValue === undefined) return DEFAULT_INIT_SCRIPT_DELAY_MS;
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed <= 0)
    return DEFAULT_INIT_SCRIPT_DELAY_MS;
  return parsed;
})();

const RACE_INIT_SCRIPT_SENTINEL = "__stagehand_init_script_race_sentinel__";
const INIT_SCRIPT_MARKER_KEY = "__stagehand_init_script_domcontentloaded__";
const POPUP_URL =
  "https://browserbase.github.io/stagehand-eval-sites/sites/oopif-in-closed-shadow-dom/";
const POPUP_CHILD_FRAME_URL =
  "https://seanmcguire12.github.io/stagehand-oopif-sites/sites/form-filling/";

const OPENER_HTML = `<!doctype html>
<html>
  <head><meta charset="utf-8" /></head>
  <body>
    <a id="open-popup" href="#">Open popup</a>
    <script>
      document.getElementById("open-popup").addEventListener("click", (event) => {
        event.preventDefault();
        window.open("${POPUP_URL}", "_blank");
      });
    </script>
  </body>
</html>`;

const OPENER_URL = `data:text/html,${encodeURIComponent(OPENER_HTML)}`;

const INIT_SCRIPT_SOURCE = `
(() => {
  const markerKey = "${INIT_SCRIPT_MARKER_KEY}";
  /* ${RACE_INIT_SCRIPT_SENTINEL} */
  const applyMarker = () => {
    window[markerKey] = true;
    document.documentElement.style.backgroundColor = "red";
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", applyMarker, { once: true });
  } else {
    applyMarker();
  }
})();
`;

type PatchedConn = {
  _sendViaSession: (
    sessionId: string,
    method: string,
    params?: object,
  ) => Promise<unknown>;
  on<P = unknown>(event: string, handler: (params: P) => void): void;
  off<P = unknown>(event: string, handler: (params: P) => void): void;
};

type SessionCommandRecord = {
  sequence: number;
  sessionId: string;
  method: string;
  isRaceInitScript: boolean;
};

async function closeAllPages(ctx: V3Context): Promise<void> {
  const pages = ctx.pages();
  await Promise.allSettled(pages.map((page) => page.close()));
}

async function waitForPopupPage(
  ctx: V3Context,
  knownTargetIds: Set<string>,
  timeoutMs = 15_000,
): Promise<Page> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const popup = ctx
      .pages()
      .find((candidate) => !knownTargetIds.has(candidate.targetId()));
    if (popup) return popup;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  throw new Error("Timed out waiting for popup page");
}

async function waitForPageUrl(
  page: Page,
  expectedUrlSubstring: string,
  timeoutMs = 15_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    let url = page.url();
    if (!url) {
      try {
        url = await page.mainFrame().evaluate(() => window.location.href);
      } catch {
        // Main-world context may not exist yet while the target is booting.
      }
    }
    if (url.includes(expectedUrlSubstring)) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  throw new Error(
    `Timed out waiting for popup url to contain ${expectedUrlSubstring}`,
  );
}

async function waitForChildFrame(
  page: Page,
  expectedUrl: string,
  timeoutMs = 15_000,
): Promise<ReturnType<Page["frames"]>[number]> {
  const mainFrameId = page.mainFrame().frameId;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    for (const frame of page.frames()) {
      if (frame.frameId === mainFrameId) continue;
      let frameUrl;
      try {
        frameUrl = await frame.evaluate(() => window.location.href);
      } catch {
        // Frame can appear before Runtime.executionContextCreated.
        continue;
      }
      if (frameUrl === expectedUrl) {
        return frame;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  throw new Error(`Timed out waiting for child frame ${expectedUrl}`);
}

test.describe("repro: popup iframe addInitScript race under delayed CDP send", () => {
  test.describe.configure({ mode: "serial" });

  let restoreSend: (() => void) | undefined;
  let v3: V3 | undefined;
  let ctx: V3Context | undefined;
  let sequence = 0;
  let records: SessionCommandRecord[] = [];

  test.beforeAll(async () => {
    v3 = new V3(v3TestConfig);
    await v3.init();
    ctx = v3.context;

    const conn = (ctx as unknown as { conn?: PatchedConn }).conn;
    if (!conn || typeof conn._sendViaSession !== "function") {
      throw new Error("Unable to access CDP connection for race repro patch");
    }

    const originalSendViaSession = conn._sendViaSession.bind(conn);
    conn._sendViaSession = function patchedSendViaSession(
      sessionId: string,
      method: string,
      params?: object,
    ) {
      const source =
        typeof (params as { source?: unknown } | undefined)?.source === "string"
          ? (params as { source: string }).source
          : "";
      const isRaceInitScript =
        method === "Page.addScriptToEvaluateOnNewDocument" &&
        source.includes(RACE_INIT_SCRIPT_SENTINEL);

      const sendNow = () => {
        records.push({
          sequence: ++sequence,
          sessionId,
          method,
          isRaceInitScript,
        });
        return originalSendViaSession(sessionId, method, params);
      };

      if (isRaceInitScript && INIT_SCRIPT_DELAY_MS > 0) {
        return new Promise((resolve, reject) => {
          setTimeout(() => {
            sendNow().then(resolve, reject);
          }, INIT_SCRIPT_DELAY_MS);
        });
      }

      return sendNow();
    };

    restoreSend = () => {
      conn._sendViaSession = originalSendViaSession;
    };

    await ctx.addInitScript(INIT_SCRIPT_SOURCE);
  });

  test.afterAll(async () => {
    restoreSend?.();
    await v3?.close?.().catch(() => {});
  });

  test.beforeEach(async () => {
    records = [];
    sequence = 0;
    if (!ctx) return;
    await closeAllPages(ctx);
  });

  test.afterEach(async () => {
    if (!ctx) return;
    await closeAllPages(ctx);
  });

  test("should send addScript before resume for popup targets and preserve DOMContentLoaded behavior", async () => {
    if (!ctx) throw new Error("Context not initialized");

    const page = await ctx.newPage();
    await page.goto(OPENER_URL, { waitUntil: "domcontentloaded" });
    const knownTargetIds = new Set(ctx.pages().map((p) => p.targetId()));
    await page.locator("#open-popup").click();

    const popup = await waitForPopupPage(ctx, knownTargetIds);
    await popup.waitForLoadState("domcontentloaded", 15_000);
    await waitForPageUrl(popup, POPUP_URL, 15_000);
    const iframe = await waitForChildFrame(
      popup,
      POPUP_CHILD_FRAME_URL,
      15_000,
    );

    const popupDomContentLoadedMarker = await popup
      .mainFrame()
      .evaluate((key) => {
        return Boolean(Reflect.get(window, key));
      }, INIT_SCRIPT_MARKER_KEY);
    const iframeDomContentLoadedMarker = await iframe.evaluate((key) => {
      return Boolean(Reflect.get(window, key));
    }, INIT_SCRIPT_MARKER_KEY);

    const perSession = new Map<
      string,
      {
        raceInitScriptSequence?: number;
        resumeSequence?: number;
      }
    >();
    for (const record of records) {
      const entry = perSession.get(record.sessionId) ?? {};
      if (
        record.isRaceInitScript &&
        entry.raceInitScriptSequence === undefined
      ) {
        entry.raceInitScriptSequence = record.sequence;
      }
      if (
        record.method === "Runtime.runIfWaitingForDebugger" &&
        entry.resumeSequence === undefined
      ) {
        entry.resumeSequence = record.sequence;
      }
      perSession.set(record.sessionId, entry);
    }

    const comparableSessions = [...perSession.entries()]
      .map(([sessionId, entry]) => ({ sessionId, ...entry }))
      .filter(
        (entry) =>
          entry.raceInitScriptSequence !== undefined &&
          entry.resumeSequence !== undefined,
      );
    expect(comparableSessions.length).toBeGreaterThan(0);

    const orderingViolations = comparableSessions.filter((entry) => {
      return (
        (entry.raceInitScriptSequence as number) >
        (entry.resumeSequence as number)
      );
    });

    expect(
      orderingViolations,
      `Expected addScript to be sent before resume. initScriptDelayMs=${INIT_SCRIPT_DELAY_MS}; comparableSessions=${JSON.stringify(comparableSessions)}`,
    ).toEqual([]);
    expect(popupDomContentLoadedMarker).toBe(true);
    expect(iframeDomContentLoadedMarker).toBe(true);
  });
});
