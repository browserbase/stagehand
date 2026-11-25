import fc from "fast-check";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  BrowserbaseSessionReleaseError,
  releaseBrowserbaseSession,
} from "../extension/lib/session-release.js";
import {
  StagehandSession,
  closeStagehandResources,
  createStagehandResourceFactory,
  type StagehandResources,
} from "../extension/lib/session.js";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  retrieve: vi.fn(),
  update: vi.fn(),
}));

vi.mock("@browserbasehq/sdk", () => ({
  default: class Browserbase {
    readonly sessions = {
      retrieve: mocks.retrieve,
      update: mocks.update,
    };

    constructor(options: unknown) {
      mocks.createClient(options);
    }
  },
}));

const NUM_RUNS = (() => {
  const parsed = Number.parseInt(process.env.FC_NUM_RUNS ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 100;
})();

const ASYNC_FC_OPTS =
  process.env.FC_UNSEEDED === "1"
    ? { numRuns: Math.min(NUM_RUNS, 200) }
    : { seed: 202604055, numRuns: Math.min(NUM_RUNS, 80) };

function makeResources(browserCloseFails = false): StagehandResources {
  const browser = {
    closed: false,
    context: { pages: vi.fn(async () => [{}]) },
    close: vi.fn(async function (this: { closed: boolean }) {
      if (browserCloseFails) throw new Error("CDP close failed");
      this.closed = true;
    }),
  };
  const resources = Object.create(null) as StagehandResources;
  return Object.assign(resources, {
    browser,
    stagehand: { close: vi.fn(async () => undefined) },
  });
}

describe("eve session release formal properties", () => {
  beforeEach(() => {
    mocks.createClient.mockReset();
    mocks.retrieve.mockReset();
    mocks.update.mockReset();
  });

  it("confines sessionId to a single safe URL path segment and rejects traversal/empty IDs", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom("", " ", "\t", ".", ".."),
        fc.constantFrom(undefined, "", "   ", "https://api.example.test///"),
        async (badId, baseUrl) => {
          mocks.createClient.mockReset();
          mocks.update.mockReset();
          mocks.retrieve.mockReset();

          await expect(
            releaseBrowserbaseSession({
              apiKey: "secret-api-key",
              ...(baseUrl !== undefined && { baseUrl }),
              sessionId: badId,
            }),
          ).rejects.toBeInstanceOf(BrowserbaseSessionReleaseError);
          expect(mocks.update).not.toHaveBeenCalled();
          expect(mocks.retrieve).not.toHaveBeenCalled();
        },
      ),
      { seed: 202604055, numRuns: 20 },
    );

    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 60 }).filter((s) => {
          const t = s.trim();
          return t.length > 0 && s !== "." && s !== "..";
        }),
        fc.constantFrom(
          undefined,
          "",
          "   ",
          "https://api.example.test///",
          "https://api.browserbase.com/",
        ),
        fc.boolean(),
        fc.constantFrom("COMPLETED", "RUNNING", "ERROR"),
        async (sessionId, baseUrl, updateSucceeds, remoteStatus) => {
          mocks.createClient.mockReset();
          mocks.update.mockReset();
          mocks.retrieve.mockReset();

          if (updateSucceeds) {
            mocks.update.mockResolvedValueOnce({ status: "COMPLETED" });
          } else {
            mocks.update.mockRejectedValueOnce(new Error("update error with secret-api-key"));
            mocks.retrieve.mockResolvedValueOnce({ status: remoteStatus });
          }

          const promise = releaseBrowserbaseSession({
            apiKey: "secret-api-key",
            ...(baseUrl !== undefined && { baseUrl }),
            sessionId,
          });

          if (updateSucceeds || remoteStatus === "COMPLETED") {
            await expect(promise).resolves.toBeUndefined();
          } else {
            const err = await promise.catch((e: unknown) => e);
            expect(err).toBeInstanceOf(BrowserbaseSessionReleaseError);
            expect(String(err)).not.toContain("secret-api-key");
          }

          const clientOpts = mocks.createClient.mock.calls[0]?.[0] as { baseURL: string };
          expect(clientOpts.baseURL.length).toBeGreaterThan(0);
          expect(clientOpts.baseURL.endsWith("/")).toBe(false);

          const encodedId = mocks.update.mock.calls[0]?.[0] as string;
          expect(encodedId).not.toContain("/");
          expect(encodedId).not.toContain("?");
          expect(encodedId).not.toContain("#");
          expect(encodedId).not.toBe(".");
          expect(encodedId).not.toBe("..");
        },
      ),
      ASYNC_FC_OPTS,
    );
  });

  it("enforces idempotent single-release under concurrent AND repeated sequential teardown calls", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 2, max: 8 }),
        fc.integer({ min: 1, max: 4 }),
        async (concurrentCalls, sequentialCalls) => {
          let releaseCalls = 0;
          const releaseSession = vi.fn(async () => {
            releaseCalls += 1;
            await Promise.resolve();
          });

          const raw = makeResources(true);
          const factory = createStagehandResourceFactory(
            async () => ({ browser: raw.browser, releaseSession }),
            async () => raw.stagehand,
          );
          const resources = await factory();

          await Promise.all(
            Array.from({ length: concurrentCalls }, () => closeStagehandResources(resources)),
          );
          for (let i = 0; i < sequentialCalls; i += 1) {
            await closeStagehandResources(resources);
          }

          expect(releaseCalls).toBe(1);
        },
      ),
      ASYNC_FC_OPTS,
    );
  });

  it("StagehandSession.close detaches and cleans up at most once under concurrent close storms", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 2, max: 10 }), async (stormSize) => {
        const res = makeResources(false);
        const cleanup = vi.fn(async () => {
          await Promise.resolve();
        });
        const session = new StagehandSession(async () => res, cleanup);
        await session.run(async () => "ready");

        await Promise.all(Array.from({ length: stormSize }, () => session.close(res)));
        await session.close(res);

        expect(cleanup).toHaveBeenCalledTimes(1);
      }),
      ASYNC_FC_OPTS,
    );
  });
});
