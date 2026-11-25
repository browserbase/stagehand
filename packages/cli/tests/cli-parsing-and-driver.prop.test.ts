import { localBrowser, Stagehand } from "@browserbasehq/stagehand";
import fc from "fast-check";
import { afterEach, describe, expect, it, vi } from "vitest";

import { reduceLogs } from "../src/lib/cloud/reduce-logs.js";
import {
  aliasSuggestions,
  extractCommandTokens,
  suggestCommand,
} from "../src/lib/command-suggestions.js";
import { resolveSelector, type RefMaps } from "../src/lib/driver/commands/selectors.js";
import { formatSnapshotTree } from "../src/lib/driver/commands/snapshot-format.js";
import { classifyDriverError } from "../src/lib/driver/error-classifier.js";
import { DriverError } from "../src/lib/driver/errors.js";
import { DriverSessionManager, initFailureBackoffMs } from "../src/lib/driver/session-manager.js";
import { normalizeUrlScheme } from "../src/lib/normalize-url.js";

const SEED_BASE = 20261126;

describe("normalizeUrlScheme property verification", () => {
  const urlCandidateArb = fc.oneof(
    fc.string({ maxLength: 100 }),
    fc.constantFrom(
      "",
      " ",
      "\t",
      "\n",
      ".",
      "..",
      "...",
      "./index.html",
      "../secret",
      ".env",
      "a..b",
      "example.com",
      "example.com:8080/path?q=1#frag",
      "example.com:99999",
      "example.com\tfoo",
      "example.com\nfoo",
      "example.com\r\nfoo",
      "a.b\0c",
      "localhost",
      "localhost:3000/app?x=1#top",
      "LOCALHOST:3000",
      "127.0.0.1",
      "127.0.0.1:8080/x",
      "192.168.1.1:8080",
      "999.999.999.999",
      "1.2.3.4.5",
      "[::1]:3000",
      "http://example.com",
      "https://example.com/a?b=1",
      "HTTP://EXAMPLE.COM",
      "javascript:alert(1)",
      "javascript:123",
      "file:///etc/passwd",
      "data:text/html,<h1>hi</h1>",
      "about:blank",
      "mailto:user@example.com",
      "//example.com",
      "münchen.de/path",
    ),
  );

  it("is crash-free, idempotent, and only prepends schemes when the result is a valid URL", () => {
    fc.assert(
      fc.property(urlCandidateArb, (input) => {
        const once = normalizeUrlScheme(input);
        const twice = normalizeUrlScheme(once);
        expect(twice).toBe(once);

        if (once !== input) {
          expect(once.startsWith("http://") || once.startsWith("https://")).toBe(true);
          expect(/\s/.test(once)).toBe(false);
          expect(URL.canParse(once)).toBe(true);
          const parsed = new URL(once);
          expect(parsed.hostname.length).toBeGreaterThan(0);
          expect(parsed.hostname).not.toBe(".");
          expect(parsed.hostname).not.toBe("..");
        }
      }),
      { numRuns: 300, seed: SEED_BASE + 1 },
    );
  });

  it("never prefixes explicit schemes or relative dot paths", () => {
    const schemeArb = fc.constantFrom(
      "http",
      "https",
      "file",
      "about",
      "javascript",
      "data",
      "mailto",
      "ws",
    );
    const restArb = fc.stringMatching(/^[A-Za-z][A-Za-z0-9/_.:?&#=-]{0,40}$/);

    fc.assert(
      fc.property(schemeArb, restArb, (scheme, rest) => {
        const full = `${scheme}:${rest}`;
        expect(normalizeUrlScheme(full)).toBe(full);
      }),
      { numRuns: 100, seed: SEED_BASE + 2 },
    );

    for (const rel of [
      ".",
      "..",
      "./index.html",
      "../foo",
      ".env",
      "a..b",
      "example.com\tfoo",
      "example.com\nfoo",
    ]) {
      expect(normalizeUrlScheme(rel)).toBe(rel);
    }
  });

  it("assigns http:// to localhost/127.0.0.1 and https:// to valid external domains", () => {
    const validPortArb = fc.option(fc.integer({ min: 1, max: 65535 }), { nil: undefined });
    const suffixArb = fc.constantFrom("", "/", "/path?a=1#b", "?q=1");

    fc.assert(
      fc.property(
        fc.constantFrom("localhost", "LOCALHOST", "127.0.0.1"),
        validPortArb,
        suffixArb,
        (host, port, suffix) => {
          const raw = `${host}${port ? `:${port}` : ""}${suffix}`;
          expect(normalizeUrlScheme(raw)).toBe(`http://${raw}`);
        },
      ),
      { numRuns: 80, seed: SEED_BASE + 3 },
    );

    const domainLabelArb = fc.stringMatching(/^[a-z][a-z0-9]{0,10}$/);
    fc.assert(
      fc.property(
        domainLabelArb,
        domainLabelArb,
        validPortArb,
        suffixArb,
        (sub, tld, port, suffix) => {
          const raw = `${sub}.${tld}${port ? `:${port}` : ""}${suffix}`;
          expect(normalizeUrlScheme(raw)).toBe(`https://${raw}`);
        },
      ),
      { numRuns: 80, seed: SEED_BASE + 4 },
    );
  });
});

describe("selectors property verification", () => {
  it("always returns a string or throws DriverError(stale_ref) and never leaks prototype properties", () => {
    const protoKeys = ["toString", "constructor", "valueOf", "hasOwnProperty", "__proto__"];
    const selectorArb = fc.oneof(
      fc.string({ maxLength: 80 }),
      fc.constantFrom(...protoKeys).chain((k) => fc.constantFrom(`@${k}`, `@[${k}]`, `ref=${k}`)),
      fc
        .tuple(fc.nat(99), fc.nat(99))
        .chain(([a, b]) =>
          fc.constantFrom(
            `${a}-${b}`,
            `[${a}-${b}]`,
            `@${a}-${b}`,
            `@[${a}-${b}]`,
            `ref=${a}-${b}`,
          ),
        ),
    );

    const refMapArb: fc.Arbitrary<RefMaps> = fc
      .dictionary(
        fc.tuple(fc.nat(5), fc.nat(5)).map(([a, b]) => `${a}-${b}`),
        fc.string({ minLength: 1, maxLength: 30 }).map((s) => `/${s}`),
        { maxKeys: 8 },
      )
      .map((xpathMap) => ({ urlMap: {}, xpathMap }));

    fc.assert(
      fc.property(selectorArb, refMapArb, (selector, refMaps) => {
        try {
          const resolved = resolveSelector(selector, refMaps);
          expect(typeof resolved).toBe("string");
        } catch (error) {
          expect(error).toBeInstanceOf(DriverError);
          expect((error as DriverError).code).toBe("stale_ref");
        }
      }),
      { numRuns: 200, seed: SEED_BASE + 5 },
    );
  });

  it("resolves all equivalent ref syntaxes identically when present in xpathMap", () => {
    fc.assert(
      fc.property(
        fc.nat(999),
        fc.nat(999),
        fc.string({ minLength: 1, maxLength: 40 }).map((s) => `/html/${s}`),
        (frame, node, xpath) => {
          const key = `${frame}-${node}`;
          const maps: RefMaps = { urlMap: {}, xpathMap: { [key]: xpath } };
          expect(resolveSelector(`@${key}`, maps)).toBe(xpath);
          expect(resolveSelector(`@[${key}]`, maps)).toBe(xpath);
          expect(resolveSelector(`[${key}]`, maps)).toBe(xpath);
          expect(resolveSelector(`ref=${key}`, maps)).toBe(xpath);
          expect(resolveSelector(key, maps)).toBe(xpath);
        },
      ),
      { numRuns: 80, seed: SEED_BASE + 6 },
    );
  });
});

describe("formatSnapshotTree property verification", () => {
  const treeLineArb = fc
    .tuple(
      fc.integer({ min: 0, max: 6 }),
      fc.constantFrom("button", "link", "generic", "text", "heading", "textbox"),
      fc.option(fc.tuple(fc.nat(9), fc.nat(99)), { nil: undefined }),
      fc.string({ maxLength: 30 }).map((s) => s.replaceAll("\n", " ")),
    )
    .map(
      ([depth, role, ref, label]) =>
        `${"  ".repeat(depth)}- ${role}${ref ? ` [${ref[0]}-${ref[1]}]` : ""}: ${label}`,
    );

  const treeArb = fc
    .array(treeLineArb, { minLength: 0, maxLength: 30 })
    .map((lines) => lines.join("\n"));

  it("never crashes and never increases line count across arbitrary options", () => {
    const filterArb = fc.option(
      fc.oneof(
        fc.string({ maxLength: 30 }),
        fc.constantFrom("/button/g", "/button/gi", "/button/y", "/[invalid/", "/link/i", "submit"),
      ),
      { nil: undefined },
    );

    fc.assert(
      fc.property(
        treeArb,
        fc.record({
          compact: fc.option(fc.boolean(), { nil: undefined }),
          filter: filterArb,
          maxDepth: fc.option(fc.integer({ min: -2, max: 10 }), { nil: undefined }),
        }),
        (tree, opts) => {
          const out = formatSnapshotTree(tree, opts);
          expect(typeof out).toBe("string");
          const inCount = tree.split("\n").length;
          const outCount = out === "" ? 0 : out.split("\n").length;
          expect(outCount).toBeLessThanOrEqual(inCount);
        },
      ),
      { numRuns: 150, seed: SEED_BASE + 7 },
    );
  });

  it("matches identically for regex filters with or without the stateful g flag", () => {
    const patternTokenArb = fc.constantFrom("button", "link", "textbox", "heading", "\\[0-");
    fc.assert(
      fc.property(treeArb, patternTokenArb, fc.boolean(), (tree, token, ignoreCase) => {
        const suffix = ignoreCase ? "i" : "";
        const stateless = formatSnapshotTree(tree, { filter: `/${token}/${suffix}` });
        const withG = formatSnapshotTree(tree, { filter: `/${token}/g${suffix}` });
        expect(withG).toBe(stateless);
      }),
      { numRuns: 100, seed: SEED_BASE + 8 },
    );
    expect(formatSnapshotTree("- button: a\n- button: b", { filter: "/- button/y" })).toBe(
      "- button: a\n- button: b",
    );
  });

  it("scales linearly on deep/flat indented trees without quadratic blowup", () => {
    const hugeTree = Array.from({ length: 4000 }, (_, i) => `  - button [0-${i}]: item ${i}`).join(
      "\n",
    );
    const started = performance.now();
    const out = formatSnapshotTree(hugeTree, { compact: true, filter: "/button/g" });
    const elapsedMs = performance.now() - started;
    expect(out.split("\n")).toHaveLength(4000);
    expect(elapsedMs).toBeLessThan(500);
  });
});

describe("reduceLogs property verification", () => {
  const cdpMethodArb = fc.oneof(
    fc.constantFrom(
      "Runtime.consoleAPICalled",
      "Runtime.exceptionThrown",
      "Log.entryAdded",
      "Network.responseReceived",
      "Network.loadingFailed",
      "Page.lifecycleEvent",
    ),
    fc.string({ maxLength: 30 }),
  );

  const rawLogEntryArb: fc.Arbitrary<unknown> = fc.oneof(
    fc.constant(null),
    fc.constant(undefined),
    fc.integer(),
    fc.string({ maxLength: 20 }),
    fc.record({
      method: fc.option(cdpMethodArb, { nil: undefined }),
      request: fc.option(
        fc.record({
          rawBody: fc.option(
            fc.oneof(
              fc.string({ maxLength: 60 }),
              fc.jsonValue().map((v) => JSON.stringify(v)),
              fc.jsonValue().map((params) => JSON.stringify({ params })),
              fc
                .record({
                  type: fc.oneof(
                    fc.constantFrom("error", "warning", "assert", "info"),
                    fc.jsonValue(),
                  ),
                  args: fc.jsonValue(),
                  exceptionDetails: fc.record({
                    exception: fc.option(fc.record({ description: fc.jsonValue() }), {
                      nil: undefined,
                    }),
                    text: fc.jsonValue(),
                  }),
                  entry: fc.record({
                    level: fc.oneof(fc.constantFrom("error", "warning", "info"), fc.jsonValue()),
                    text: fc.jsonValue(),
                    url: fc.jsonValue(),
                  }),
                  response: fc.record({
                    status: fc.oneof(fc.integer({ min: 100, max: 599 }), fc.jsonValue()),
                    url: fc.jsonValue(),
                  }),
                  errorText: fc.oneof(
                    fc.constantFrom("net::ERR_ABORTED", "net::ERR_FAILED"),
                    fc.jsonValue(),
                  ),
                })
                .map((params) => JSON.stringify({ params })),
            ),
            { nil: undefined },
          ),
        }),
        { nil: undefined },
      ),
    }),
  );

  it("never crashes on malformed logs, deduplicates output, respects failedRequests, and bounds stack lines", () => {
    fc.assert(
      fc.property(
        fc.array(rawLogEntryArb, { maxLength: 30 }),
        fc.boolean(),
        (raw, failedRequests) => {
          const reduced = reduceLogs(raw as Parameters<typeof reduceLogs>[0], {
            failedRequests,
          }) as Array<Record<string, unknown>>;
          expect(reduced.length).toBeLessThanOrEqual(raw.length);

          const serialized = reduced.map((r) => JSON.stringify(r));
          expect(new Set(serialized).size).toBe(serialized.length);

          for (const rec of reduced) {
            if (failedRequests) {
              expect(rec.domain).toBe("Network");
            }
            if (rec.kind === "network.failed") {
              expect(rec.error).not.toBe("net::ERR_ABORTED");
            }
            if (
              (rec.kind === "exception" || String(rec.kind).startsWith("console.")) &&
              typeof rec.text === "string"
            ) {
              expect(rec.text.split("\n").length).toBeLessThanOrEqual(4);
            }
          }
        },
      ),
      { numRuns: 200, seed: SEED_BASE + 9 },
    );

    expect(
      reduceLogs([
        {
          method: "Runtime.exceptionThrown",
          request: {
            rawBody: JSON.stringify({
              params: {
                exceptionDetails: {
                  exception: { description: 12345 },
                  text: { nested: true },
                },
              },
            }),
          },
        },
      ]),
    ).toEqual([
      {
        kind: "exception",
        domain: "Runtime",
        severity: "error",
        text: "",
      },
    ]);
  });
});

describe("classifyDriverError property verification", () => {
  it("is total and deterministic on arbitrary unknown values including null-prototype and hostile objects", () => {
    const nullProtoObj = Object.create(null) as Record<string, unknown>;
    const throwingToString = {
      toString() {
        throw new Error("hostile toString");
      },
    };
    const throwingPrimitive = {
      [Symbol.toPrimitive]() {
        throw new Error("hostile toPrimitive");
      },
    };

    const unknownErrorArb: fc.Arbitrary<unknown> = fc.oneof(
      fc.anything(),
      fc.string({ maxLength: 120 }).map((m) => new Error(m)),
      fc.constant(Symbol("sym")),
      fc.bigInt(),
      fc.constant(nullProtoObj),
      fc.constant(throwingToString),
      fc.constant(throwingPrimitive),
    );

    fc.assert(
      fc.property(unknownErrorArb, (input) => {
        const first = classifyDriverError(input);
        const second = classifyDriverError(input);
        if (first === null) {
          expect(second).toBeNull();
        } else {
          expect(first).toBeInstanceOf(DriverError);
          expect(second).toBeInstanceOf(DriverError);
          expect(first.code).toBe(second?.code);
          expect(first.message).toBe(second?.message);
          expect(first.cause).toBe(input);
        }
      }),
      { numRuns: 200, seed: SEED_BASE + 10 },
    );
  });

  it("classifies every documented error pattern consistently", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 600_000 }),
        fc.stringMatching(/^[a-zA-Z0-9_.[\]@="'/-]{1,30}$/),
        (ms, selector) => {
          expect(
            classifyDriverError(
              new Error(`Could not find an element for the given xPath(s): ${selector}`),
            )?.code,
          ).toBe("element_not_found");
          expect(
            classifyDriverError(new Error(`waitForSelector timed out after ${ms}ms`))?.code,
          ).toBe("wait_timeout");
          expect(
            classifyDriverError(new Error(`RPC response timed out after ${ms}ms: page.goto`))?.code,
          ).toBe("navigation_timeout");
          expect(
            classifyDriverError(new Error(`RPC response timed out after ${ms}ms: page.title`))
              ?.code,
          ).toBe("page_unresponsive");
          expect(classifyDriverError(new Error("Cannot navigate to invalid URL"))?.code).toBe(
            "invalid_url",
          );
          expect(classifyDriverError(new Error("RPC client is closed"))?.code).toBe(
            "browser_disconnected",
          );
          expect(
            classifyDriverError(
              new Error("Unable to resolve CDP endpoint from http://127.0.0.1:9222"),
            )?.code,
          ).toBe("cdp_unreachable");
          expect(classifyDriverError(new Error("Cannot close the last tab."))?.code).toBe(
            "last_tab",
          );
        },
      ),
      { numRuns: 60, seed: SEED_BASE + 11 },
    );
  });
});

describe("command-suggestions property verification", () => {
  const commandIds = [
    "open",
    "status",
    "stop",
    "doctor",
    "snapshot",
    "click",
    "cloud:search",
    "cloud:fetch",
    "cloud:sessions:list",
    "cloud:sessions:create",
    "cloud:secrets:create",
    "functions:secrets:detach",
  ];
  const validTargets = new Set([...commandIds, ...aliasSuggestions.values()]);

  it("sanitizes extracted tokens, bounds length, and only suggests known commands or aliases", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 200 }), (id) => {
        const tokens = extractCommandTokens(id);
        expect(tokens.length).toBeLessThanOrEqual(4);
        for (const token of tokens) {
          expect(token).toMatch(/^[a-z][a-z0-9_-]*$/);
        }

        const first = suggestCommand(id, commandIds);
        const second = suggestCommand(id, commandIds);
        expect(first).toEqual(second);

        if (first.attempted !== "") {
          expect(first.attempted).toMatch(/^[a-z][a-z0-9_-]*(?::[a-z][a-z0-9_-]*){0,3}$/);
        }
        if (first.suggestion !== null) {
          expect(validTargets.has(first.suggestion)).toBe(true);
        }
      }),
      { numRuns: 250, seed: SEED_BASE + 12 },
    );
  });

  it("handles huge adversarial command IDs in bounded time", () => {
    const hugeToken = "a".repeat(80_000);
    const hugeColons = ":".repeat(80_000);
    const started = performance.now();
    expect(suggestCommand(hugeToken, commandIds).suggestion).toBeNull();
    expect(suggestCommand(hugeColons, commandIds)).toEqual({ attempted: "", suggestion: null });
    expect(performance.now() - started).toBeLessThan(200);
  });
});

describe("DriverSessionManager stateful property verification", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps initFailureBackoffMs finite, bounded, and monotonic across all numeric inputs", () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constantFrom(Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -0, 0),
          fc.integer({ min: -100, max: 1000 }),
          fc.double({ noDefaultInfinity: false, noNaN: false }),
        ),
        (n) => {
          const ms = initFailureBackoffMs(n);
          expect(Number.isFinite(ms)).toBe(true);
          expect(ms).toBeGreaterThanOrEqual(5_000);
          expect(ms).toBeLessThanOrEqual(60_000);
        },
      ),
      { numRuns: 150, seed: SEED_BASE + 13 },
    );

    fc.assert(
      fc.property(fc.integer({ min: 0, max: 50 }), fc.integer({ min: 0, max: 50 }), (a, b) => {
        const lo = Math.min(a, b);
        const hi = Math.max(a, b);
        expect(initFailureBackoffMs(lo)).toBeLessThanOrEqual(initFailureBackoffMs(hi));
      }),
      { numRuns: 80, seed: SEED_BASE + 14 },
    );
  });

  it("never leaks browsers/stagehands or double-closes under concurrent init/close/error sequences", async () => {
    interface TrackedBrowser {
      id: number;
      closeCount: number;
      closeOrder: number;
      close: () => Promise<void>;
      context: {
        activePage: () => Promise<{
          pageId: string;
          title: () => Promise<string>;
          url: () => Promise<string>;
        }>;
        pages: () => Promise<
          Array<{ pageId: string; title: () => Promise<string>; url: () => Promise<string> }>
        >;
        newPage: () => Promise<{
          pageId: string;
          title: () => Promise<string>;
          url: () => Promise<string>;
        }>;
        setActivePage: () => Promise<void>;
      };
    }

    interface TrackedStagehand {
      id: number;
      browserId: number;
      closeCount: number;
      closeOrder: number;
      browser: TrackedBrowser;
      close: () => Promise<void>;
    }

    interface HarnessState {
      browsers: TrackedBrowser[];
      stagehands: TrackedStagehand[];
      nextBrowserId: number;
      nextStagehandId: number;
      closeTick: number;
      launchMode: "ok" | "fail-launch" | "fail-create" | "slow-launch" | "slow-create";
      pendingResolve: (() => void) | null;
    }

    const harness: HarnessState = {
      browsers: [],
      stagehands: [],
      nextBrowserId: 1,
      nextStagehandId: 1,
      closeTick: 0,
      launchMode: "ok",
      pendingResolve: null,
    };

    const makeBrowser = (): TrackedBrowser => {
      const id = harness.nextBrowserId++;
      const page = {
        pageId: `page-${id}`,
        title: async () => `Title ${id}`,
        url: async () => "https://example.com",
      };
      const tracked: TrackedBrowser = {
        id,
        closeCount: 0,
        closeOrder: 0,
        close: async () => {
          tracked.closeCount += 1;
          tracked.closeOrder = ++harness.closeTick;
        },
        context: {
          activePage: async () => page,
          pages: async () => [page],
          newPage: async () => page,
          setActivePage: async () => undefined,
        },
      };
      harness.browsers.push(tracked);
      return tracked;
    };

    const launchMock = vi.spyOn(localBrowser, "launch").mockImplementation((async () => {
      if (harness.launchMode === "fail-launch") {
        throw new Error("mock launch failure");
      }
      if (harness.launchMode === "slow-launch") {
        await new Promise<void>((resolve) => {
          harness.pendingResolve = resolve;
        });
      }
      return makeBrowser();
    }) as unknown as typeof localBrowser.launch);

    const createMock = vi.spyOn(Stagehand, "create").mockImplementation((async ({
      browser,
    }: {
      browser: TrackedBrowser;
    }) => {
      if (harness.launchMode === "fail-create") {
        throw new Error("mock stagehand create failure");
      }
      if (harness.launchMode === "slow-create") {
        await new Promise<void>((resolve) => {
          harness.pendingResolve = resolve;
        });
      }
      const id = harness.nextStagehandId++;
      const tracked: TrackedStagehand = {
        id,
        browserId: browser.id,
        closeCount: 0,
        closeOrder: 0,
        browser,
        close: async () => {
          tracked.closeCount += 1;
          tracked.closeOrder = ++harness.closeTick;
        },
      };
      harness.stagehands.push(tracked);
      return tracked;
    }) as unknown as typeof Stagehand.create);

    void launchMock;
    void createMock;

    type SessionAction =
      | { kind: "init"; mode: "ok" | "fail-launch" | "fail-create" }
      | { kind: "concurrent-init-close"; slowStage: "slow-launch" | "slow-create" }
      | { kind: "concurrent-double-init" }
      | { kind: "close" }
      | { kind: "apply-env"; key: string }
      | { kind: "status" }
      | { kind: "set-ref"; refKey: string };

    const actionArb: fc.Arbitrary<SessionAction> = fc.oneof(
      fc.record({
        kind: fc.constant("init" as const),
        mode: fc.constantFrom("ok" as const, "fail-launch" as const, "fail-create" as const),
      }),
      fc.record({
        kind: fc.constant("concurrent-init-close" as const),
        slowStage: fc.constantFrom("slow-launch" as const, "slow-create" as const),
      }),
      fc.constant({ kind: "concurrent-double-init" as const }),
      fc.constant({ kind: "close" as const }),
      fc.record({
        kind: fc.constant("apply-env" as const),
        key: fc.constantFrom("", "key-a", "key-b"),
      }),
      fc.constant({ kind: "status" as const }),
      fc.record({
        kind: fc.constant("set-ref" as const),
        refKey: fc.constantFrom("0-1", "1-2"),
      }),
    );

    const assertNoResourceBugs = (expectAllClosed: boolean) => {
      for (const b of harness.browsers) {
        expect(b.closeCount).toBeLessThanOrEqual(1);
        if (expectAllClosed) expect(b.closeCount).toBe(1);
      }
      for (const s of harness.stagehands) {
        expect(s.closeCount).toBeLessThanOrEqual(1);
        if (expectAllClosed) expect(s.closeCount).toBe(1);
        if (s.closeCount === 1 && s.browser.closeCount === 1) {
          expect(s.closeOrder).toBeLessThan(s.browser.closeOrder);
        }
      }
      const liveBrowsers = harness.browsers.filter((b) => b.closeCount === 0);
      expect(liveBrowsers.length).toBeLessThanOrEqual(expectAllClosed ? 0 : 1);
    };

    await fc.assert(
      fc.asyncProperty(fc.array(actionArb, { minLength: 1, maxLength: 14 }), async (actions) => {
        harness.browsers.length = 0;
        harness.stagehands.length = 0;
        harness.nextBrowserId = 1;
        harness.nextStagehandId = 1;
        harness.closeTick = 0;
        harness.launchMode = "ok";
        harness.pendingResolve = null;

        const manager = new DriverSessionManager("stateful-prop", {
          kind: "managed-local",
          headless: true,
        });

        for (const action of actions) {
          switch (action.kind) {
            case "init": {
              harness.launchMode = action.mode;
              try {
                await manager.activePage();
              } catch {
                void 0;
              }
              break;
            }
            case "concurrent-init-close": {
              const beforeStatus = await manager.status();
              if (!beforeStatus.initialized) {
                harness.launchMode = action.slowStage;
                const initPromise = manager.stagehandInstance().catch(() => undefined);
                await new Promise((r) => setImmediate(r));
                const closePromise = manager.close();
                harness.pendingResolve?.();
                harness.pendingResolve = null;
                await Promise.all([initPromise, closePromise]);
                const afterStatus = await manager.status();
                expect(afterStatus.initialized).toBe(false);
                expect(afterStatus.browserConnected).toBe(false);
                expect(afterStatus.initError).toBeUndefined();
                assertNoResourceBugs(true);
              }
              break;
            }
            case "concurrent-double-init": {
              harness.launchMode = "ok";
              const beforeBrowsers = harness.browsers.length;
              const wasInit = (await manager.status()).initialized;
              await Promise.allSettled([manager.stagehandInstance(), manager.stagehandInstance()]);
              if (!wasInit) {
                expect(harness.browsers.length - beforeBrowsers).toBeLessThanOrEqual(1);
              }
              break;
            }
            case "close": {
              await manager.close();
              const st = await manager.status();
              expect(st.initialized).toBe(false);
              expect(st.browserConnected).toBe(false);
              expect(st.initError).toBeUndefined();
              expect(st.selectedTargetId).toBeUndefined();
              expect(() => manager.resolveSelector("@0-1")).toThrow(DriverError);
              assertNoResourceBugs(true);
              break;
            }
            case "apply-env": {
              manager.applyForwardedEnv(
                action.key ? { BROWSERBASE_API_KEY: action.key } : undefined,
              );
              break;
            }
            case "status": {
              const st = await manager.status();
              const liveBrowsers = harness.browsers.filter((b) => b.closeCount === 0);
              expect(st.initialized).toBe(liveBrowsers.length === 1);
              break;
            }
            case "set-ref": {
              manager.setRefMaps({ urlMap: {}, xpathMap: { [action.refKey]: "/html/body" } });
              expect(manager.resolveSelector(`@${action.refKey}`)).toBe("/html/body");
              break;
            }
            default: {
              const exhaustive: never = action;
              throw new Error(`Unhandled action: ${String(exhaustive)}`);
            }
          }
          assertNoResourceBugs(false);
        }

        await manager.close();
        assertNoResourceBugs(true);
      }),
      { numRuns: 40, seed: SEED_BASE + 15 },
    );
  });
});
