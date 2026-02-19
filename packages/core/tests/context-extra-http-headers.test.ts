import { describe, expect, it } from "vitest";
import { V3Context } from "../lib/v3/understudy/context.js";
import { MockCDPSession } from "./helpers/mockCDPSession.js";
import { StagehandSetExtraHTTPHeadersError } from "../lib/v3/types/public/sdkErrors.js";

type ContextStub = {
  _sessionInit: Set<string>;
  conn: {
    getSession: (id: string) => MockCDPSession | undefined;
  };
};

const makeContext = (sessions: MockCDPSession[]): ContextStub => {
  const sessionsById = new Map(
    sessions.map((session) => [session.id, session]),
  );
  return {
    _sessionInit: new Set(sessions.map((session) => session.id)),
    conn: {
      getSession: (id: string) => sessionsById.get(id),
    },
  };
};

describe("V3Context.setExtraHTTPHeaders", () => {
  it("sends headers to all sessions", async () => {
    const sessionA = new MockCDPSession({}, "session-a");
    const sessionB = new MockCDPSession({}, "session-b");
    const ctx = makeContext([sessionA, sessionB]);

    await V3Context.prototype.setExtraHTTPHeaders.call(ctx, {
      "x-stagehand-test": "yes",
    });

    for (const session of [sessionA, sessionB]) {
      expect(session.callsFor("Network.enable").length).toBe(1);
      expect(
        session.callsFor("Network.setExtraHTTPHeaders")[0]?.params,
      ).toEqual({
        headers: { "x-stagehand-test": "yes" },
      });
    }
  });

  it("throws a custom error with session failure details", async () => {
    const sessionA = new MockCDPSession(
      {
        "Network.setExtraHTTPHeaders": () => {
          throw new Error("boom");
        },
      },
      "session-a",
    );
    const sessionB = new MockCDPSession({}, "session-b");
    const ctx = makeContext([sessionA, sessionB]);

    const promise = V3Context.prototype.setExtraHTTPHeaders.call(ctx, {
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
      expect(err.failures[0]).toContain("boom");
    }
  });
});
