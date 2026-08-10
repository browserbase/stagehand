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

const POPUP_TIMEOUT_MS = 20_000;
const RACE_INIT_SCRIPT_SENTINEL = "__stagehand_init_script_race_sentinel__";
const INIT_SCRIPT_MARKER_KEY = "__stagehand_init_script_loaded__";
const POPUP_URL = "https://example.com/";
const POPUP_IFRAME_URL = "https://example.org/";

const INIT_SCRIPT_SOURCE = `
(() => {
  /* ${RACE_INIT_SCRIPT_SENTINEL} */
  window["${INIT_SCRIPT_MARKER_KEY}"] = true;
})();
`;

type PatchedConn = {
  _sendViaSession: (
    sessionId: string,
    method: string,
    params?: object,
  ) => Promise<unknown>;
};

type SessionCommandRecord = {
  sequence: number;
  sessionId: string;
  method: string;
  isRaceInitScript: boolean;
};

type PopupTriggerCase = {
  name: string;
  prepare: (opener: Page) => Promise<void>;
};

async function closeAllPages(ctx: V3Context): Promise<void> {
  const pages = ctx.pages();
  await Promise.allSettled(pages.map((page) => page.close()));
}

async function waitForPopupPage(
  ctx: V3Context,
  knownTargetIds: Set<string>,
  timeoutMs = POPUP_TIMEOUT_MS,
): Promise<Page> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const popup = ctx
      .pages()
      .find((candidate) => !knownTargetIds.has(candidate.targetId()));
    if (popup) return popup;
    try {
      const active = await ctx.awaitActivePage(500);
      if (!knownTargetIds.has(active.targetId())) return active;
    } catch {
      // keep polling
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  throw new Error("Timed out waiting for popup page");
}

async function waitForChildFrame(
  page: Page,
  expectedUrl: string,
  timeoutMs = POPUP_TIMEOUT_MS,
): Promise<ReturnType<Page["frames"]>[number]> {
  const mainFrameId = page.mainFrame().frameId;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    for (const frame of page.frames()) {
      if (frame.frameId === mainFrameId) continue;
      try {
        const href = await frame.evaluate(() => window.location.href);
        if (href === expectedUrl) return frame;
      } catch {
        // frame context may not be ready yet
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  throw new Error("Timed out waiting for child frame");
}

async function prepareTargetBlankPopupOpener(opener: Page): Promise<void> {
  await opener.goto("about:blank", { waitUntil: "domcontentloaded" });
  await opener.mainFrame().evaluate((popupUrl) => {
    const link = document.createElement("a");
    link.id = "open-popup";
    link.target = "_blank";
    link.href = popupUrl;
    link.textContent = "open popup";
    document.body.appendChild(link);
  }, POPUP_URL);
}

async function prepareWindowOpenPopupOpener(opener: Page): Promise<void> {
  await opener.goto("about:blank", { waitUntil: "domcontentloaded" });
  await opener.mainFrame().evaluate((popupUrl) => {
    const button = document.createElement("button");
    button.id = "open-popup";
    button.textContent = "open popup";
    button.addEventListener("click", () => {
      window.open(popupUrl, "_blank");
    });
    document.body.appendChild(button);
  }, POPUP_URL);
}

const POPUP_TRIGGER_CASES: PopupTriggerCase[] = [
  {
    name: 'target="_blank" link click',
    prepare: prepareTargetBlankPopupOpener,
  },
  {
    name: "window.open from click handler",
    prepare: prepareWindowOpenPopupOpener,
  },
];

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

  for (const popupCase of POPUP_TRIGGER_CASES) {
    test(`should send addScript before resume for popup targets via ${popupCase.name}`, async () => {
      if (!ctx) throw new Error("Context not initialized");

      const opener = await ctx.newPage();
      await popupCase.prepare(opener);

      const knownTargetIds = new Set(ctx.pages().map((p) => p.targetId()));
      const knownSessionIds = new Set(
        records.map((record) => record.sessionId),
      );

      await opener.locator("#open-popup").click();

      const popup = await waitForPopupPage(ctx, knownTargetIds);
      await popup.waitForLoadState("load", POPUP_TIMEOUT_MS);
      await popup.mainFrame().evaluate((iframeUrl) => {
        const iframe = document.createElement("iframe");
        iframe.id = "race-child-iframe";
        iframe.src = iframeUrl;
        document.body.appendChild(iframe);
      }, POPUP_IFRAME_URL);
      const iframe = await waitForChildFrame(
        popup,
        POPUP_IFRAME_URL,
        POPUP_TIMEOUT_MS,
      );

      const popupInitScriptMarker = await popup.mainFrame().evaluate((key) => {
        return Boolean(Reflect.get(window, key));
      }, INIT_SCRIPT_MARKER_KEY);
      const iframeInitScriptMarker = await iframe.evaluate((key) => {
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
        if (knownSessionIds.has(record.sessionId)) continue;
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
        `Expected addScript before resume for ${popupCase.name}. initScriptDelayMs=${INIT_SCRIPT_DELAY_MS}; comparableSessions=${JSON.stringify(comparableSessions)}`,
      ).toEqual([]);
      expect(popupInitScriptMarker).toBe(true);
      expect(iframeInitScriptMarker).toBe(true);
    });
  }
});
