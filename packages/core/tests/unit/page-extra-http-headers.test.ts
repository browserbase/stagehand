import { describe, expect, it } from "vitest";
import { Page } from "../../lib/v3/understudy/page.js";
import { MockCDPSession } from "./helpers/mockCDPSession.js";
import { StagehandSetExtraHTTPHeadersError } from "../../lib/v3/types/public/sdkErrors.js";

type PageStub = {
  mainSession: MockCDPSession;
  sessions: Map<string, MockCDPSession>;
  extraHTTPHeaders: Record<string, string>;
  applyExtraHTTPHeadersToSession: (
    session: MockCDPSession,
    headers: Record<string, string>,
  ) => Promise<void>;
};

const makePage = (sessions: MockCDPSession[]): PageStub => {
  const mainSession = sessions[0] ?? new MockCDPSession({}, "main");
  const stub: PageStub = {
    mainSession,
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

  it("applies headers to mainSession even when sessions map is empty", async () => {
    const page = makePage([]);

    await setExtraHTTPHeaders.call(page, { "x-test": "value" });

    // mainSession should still receive headers even though it's not in the sessions map
    expect(page.mainSession.callsFor("Network.enable").length).toBe(1);
    expect(
      page.mainSession.callsFor("Network.setExtraHTTPHeaders")[0]?.params,
    ).toEqual({
      headers: { "x-test": "value" },
    });
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

    let caughtError: StagehandSetExtraHTTPHeadersError | undefined;
    try {
      await setExtraHTTPHeaders.call(page, {
        "x-stagehand-test": "yes",
      });
    } catch (error) {
      caughtError = error as StagehandSetExtraHTTPHeadersError;
    }

    expect(caughtError).toBeInstanceOf(StagehandSetExtraHTTPHeadersError);
    expect(caughtError?.failures).toHaveLength(1);
    expect(caughtError?.failures[0]).toContain("session=session-a");
    expect(caughtError?.failures[0]).toContain("connection closed");

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
    await page.applyExtraHTTPHeadersToSession.call(
      page,
      sessionB,
      page.extraHTTPHeaders,
    );

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
