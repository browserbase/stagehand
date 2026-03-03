import { describe, expect, it } from "vitest";
import { Page } from "../../lib/v3/understudy/page.js";
import { MockCDPSession } from "./helpers/mockCDPSession.js";
import { StagehandSetExtraHTTPHeadersError } from "../../lib/v3/types/public/sdkErrors.js";

type PageStub = {
  sessions: Map<string, MockCDPSession>;
  extraHTTPHeaders: Record<string, string>;
  applyExtraHTTPHeadersToSession: (session: MockCDPSession) => Promise<void>;
};

const makePage = (sessions: MockCDPSession[]): PageStub => {
  const stub: PageStub = {
    sessions: new Map(sessions.map((s) => [s.id, s])),
    extraHTTPHeaders: {},
    // Bind the private helper from Page.prototype so setExtraHTTPHeaders can call it
    applyExtraHTTPHeadersToSession: (Page.prototype as unknown as PageStub)
      .applyExtraHTTPHeadersToSession,
  };
  return stub;
};

describe("Page.setExtraHTTPHeaders", () => {
  const setExtraHTTPHeaders = Page.prototype.setExtraHTTPHeaders as (
    this: PageStub,
    headers: Record<string, string>,
  ) => Promise<void>;

  it("sends headers to all sessions owned by the page", async () => {
    const sessionA = new MockCDPSession({}, "session-a");
    const sessionB = new MockCDPSession({}, "session-b");
    const page = makePage([sessionA, sessionB]);

    await setExtraHTTPHeaders.call(page, {
      "x-stagehand-test": "hello",
    });

    for (const session of [sessionA, sessionB]) {
      expect(session.callsFor("Network.enable").length).toBe(1);
      expect(
        session.callsFor("Network.setExtraHTTPHeaders")[0]?.params,
      ).toEqual({
        headers: { "x-stagehand-test": "hello" },
      });
    }
  });

  it("is a no-op when the page has no sessions", async () => {
    const page = makePage([]);

    // should resolve without throwing
    await expect(
      setExtraHTTPHeaders.call(page, { "x-test": "value" }),
    ).resolves.toBeUndefined();
  });

  it("throws StagehandSetExtraHTTPHeadersError with session failure details", async () => {
    const sessionA = new MockCDPSession(
      {
        "Network.setExtraHTTPHeaders": () => {
          throw new Error("connection closed");
        },
      },
      "session-a",
    );
    const sessionB = new MockCDPSession({}, "session-b");
    const page = makePage([sessionA, sessionB]);

    const promise = setExtraHTTPHeaders.call(page, {
      "x-stagehand-test": "yes",
    });

    await expect(promise).rejects.toBeInstanceOf(
      StagehandSetExtraHTTPHeadersError,
    );

    try {
      await promise;
    } catch (error) {
      const err = error as StagehandSetExtraHTTPHeadersError;
      expect(err.failures).toHaveLength(1);
      expect(err.failures[0]).toContain("session=session-a");
      expect(err.failures[0]).toContain("connection closed");
    }

    // sessionB should still have been called successfully
    expect(sessionB.callsFor("Network.setExtraHTTPHeaders").length).toBe(1);
  });

  it("applies headers to sessions adopted after the call", async () => {
    const sessionA = new MockCDPSession({}, "session-a");
    const page = makePage([sessionA]);

    await setExtraHTTPHeaders.call(page, { "x-before": "yes" });

    // A new OOPIF session is adopted after headers were set
    const sessionB = new MockCDPSession({}, "session-b");
    page.sessions.set(sessionB.id, sessionB);

    // Simulate what adoptOopifSession does: replay headers onto the new session
    await page.applyExtraHTTPHeadersToSession.call(page, sessionB);

    // The late-arriving session should have received the headers
    expect(sessionB.callsFor("Network.enable").length).toBe(1);
    expect(sessionB.callsFor("Network.setExtraHTTPHeaders")[0]?.params).toEqual(
      {
        headers: { "x-before": "yes" },
      },
    );
  });

  it("does not mutate the original headers object", async () => {
    const session = new MockCDPSession({}, "session-a");
    const page = makePage([session]);

    const original = { "x-custom": "value" };
    const frozen = { ...original };

    await setExtraHTTPHeaders.call(page, original);

    expect(original).toEqual(frozen);
  });
});
