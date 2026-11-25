import fc from "fast-check";
import { describe, expect, it, vi } from "vitest";
import {
  StagehandMethods,
  StagehandNotifications,
} from "@browserbasehq/stagehand-protocol/schema-registry";
import {
  AriaRoleSchema,
  LocatorChainSchema,
  LocatorRequestDescriptorSchema,
} from "@browserbasehq/stagehand-protocol/schemas";
import type { RPCMethod } from "@browserbasehq/stagehand-protocol/json-rpc/schemas";
import type {
  NavigationHeader,
  NavigationResponseDescriptor,
  StagehandRpcNotification,
  WebMCPToolDescriptor,
  WebMCPToolResponse,
} from "@browserbasehq/stagehand-protocol/types";
import { z } from "zod/v4";
import { BrowserClipboard } from "../src/browserClipboard.js";
import { BrowserContext } from "../src/browserContext.js";
import {
  serializeClientLocator,
  serializeClientLocatorOptions,
} from "../src/clientLocatorOptions.js";
import type { StagehandCommandClient } from "../src/commandClient.js";
import { Locator } from "../src/locator.js";
import { CDPSubscription, Page } from "../src/page.js";
import { browserPlatform, type BrowserApiPlatform } from "../src/platform.js";
import { Response } from "../src/response.js";
import {
  StagehandClientActOptionsSchema,
  StagehandClientExtractOptionsSchema,
  StagehandClientObserveOptionsSchema,
  WebMCPInvokeOptionsSchema,
  WebMCPResultOptionsSchema,
  WebMCPToolsOptionsSchema,
} from "../src/schemas.js";
import { WebMCPTool } from "../src/webmcp.js";

type PendingRpc = {
  id: number;
  method: string;
  params: unknown;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
};

class ControllableCommandClient implements StagehandCommandClient {
  readonly calls: Array<{ method: string; params: unknown }> = [];
  readonly listeners = new Set<(notification: StagehandRpcNotification) => void>();
  readonly pending = new Map<number, PendingRpc>();
  readonly warnings: Array<{ message: string; code: string }> = [];
  readonly platform: BrowserApiPlatform;
  #nextId = 1;
  #autoHandler?: (method: RPCMethod, params: unknown) => unknown;

  constructor(autoHandler?: (method: RPCMethod, params: unknown) => unknown) {
    this.#autoHandler = autoHandler;
    this.platform = {
      ...browserPlatform,
      emitWarning: (message, code) => {
        this.warnings.push({ message, code });
      },
    };
  }

  send<Method extends RPCMethod>(
    method: Method,
    params: z.input<Method["params"]>,
  ): Promise<z.output<Method["result"]>> {
    this.calls.push({ method: method.name, params });
    if (this.#autoHandler) {
      return Promise.resolve().then(() => this.#autoHandler!(method, params)) as Promise<
        z.output<Method["result"]>
      >;
    }
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, {
        id,
        method: method.name,
        params,
        resolve: (value) => {
          this.pending.delete(id);
          resolve(value as z.output<Method["result"]>);
        },
        reject: (error) => {
          this.pending.delete(id);
          reject(error);
        },
      });
    });
  }

  onNotification(listener: (notification: StagehandRpcNotification) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emit(notification: StagehandRpcNotification): void {
    const snapshot = Array.from(this.listeners);
    for (const listener of snapshot) {
      listener(notification);
    }
  }
}

type ChainOp =
  | { type: "locator"; selector: string }
  | { type: "getByText"; text: string; exact?: boolean }
  | { type: "getByRole"; role: z.infer<typeof AriaRoleSchema>; name?: string; exact?: boolean }
  | { type: "first" }
  | { type: "nth"; index: number };

const validCssSelectorArb = fc.constantFrom(
  "button",
  ".card",
  "#submit",
  "div > span",
  "iframe >> .inner",
  "iframe >> iframe >> button",
  "xpath=//div/button",
  "xpath=//iframe/body/a",
  "text=Click me",
  "css=section.main",
);

const chainOpArb: fc.Arbitrary<ChainOp> = fc.oneof(
  validCssSelectorArb.map((selector) => ({ type: "locator" as const, selector })),
  fc.record({
    type: fc.constant("getByText" as const),
    text: fc.string({ maxLength: 24 }),
    exact: fc.option(fc.boolean(), { nil: undefined }),
  }),
  fc.record({
    type: fc.constant("getByRole" as const),
    role: fc.constantFrom(...AriaRoleSchema.options),
    name: fc.option(fc.string({ maxLength: 20 }), { nil: undefined }),
    exact: fc.option(fc.boolean(), { nil: undefined }),
  }),
  fc.constant({ type: "first" as const }),
  fc.record({
    type: fc.constant("nth" as const),
    index: fc.oneof(fc.integer({ min: 0, max: 50 }), fc.constant(-0)),
  }),
);

function applyChainOp(target: Locator, op: ChainOp): Locator {
  switch (op.type) {
    case "locator":
      return target.locator(op.selector);
    case "getByText":
      return target.getByText(op.text, op.exact === undefined ? undefined : { exact: op.exact });
    case "getByRole": {
      const options = {
        ...(op.name === undefined ? {} : { name: op.name }),
        ...(op.exact === undefined ? {} : { exact: op.exact }),
      };
      return target.getByRole(op.role, Object.keys(options).length ? options : undefined);
    }
    case "first":
      return target.first();
    case "nth":
      return target.nth(op.index);
    default: {
      const exhaustive: never = op;
      return exhaustive;
    }
  }
}

describe("browser-api chains, subscriptions, batch interleavings & wrappers property verification", () => {
  describe("locator immutable chains & clientLocatorOptions", () => {
    it("preserves immutability across arbitrary branching chains and validates every descriptor against protocol schemas", () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 12 }),
          fc.oneof(
            validCssSelectorArb.map((s) => ({ init: "locator" as const, selector: s })),
            fc.string({ maxLength: 20 }).map((text) => ({ init: "text" as const, text })),
            fc
              .constantFrom(...AriaRoleSchema.options)
              .map((role) => ({ init: "role" as const, role })),
          ),
          fc.array(chainOpArb, { maxLength: 8 }),
          fc.array(chainOpArb, { minLength: 1, maxLength: 4 }),
          (pageId, rootSpec, prefixOps, branchOps) => {
            const client = new ControllableCommandClient();
            const page = new Page(client, { pageId });

            let current: Locator;
            switch (rootSpec.init) {
              case "locator":
                current = page.locator(rootSpec.selector);
                break;
              case "text":
                current = page.getByText(rootSpec.text);
                break;
              case "role":
                current = page.getByRole(rootSpec.role);
                break;
              default: {
                const exhaustive: never = rootSpec;
                return exhaustive;
              }
            }

            expect(LocatorRequestDescriptorSchema.parse(current.descriptor)).toStrictEqual(
              current.descriptor,
            );

            for (const op of prefixOps) {
              const parentSnapshot = structuredClone(current.descriptor);
              const next = applyChainOp(current, op);
              expect(current.descriptor).toStrictEqual(parentSnapshot);
              expect(LocatorRequestDescriptorSchema.parse(next.descriptor)).toStrictEqual(
                next.descriptor,
              );
              if ("chain" in next.descriptor) {
                expect(LocatorChainSchema.parse(next.descriptor.chain)).toStrictEqual(
                  next.descriptor.chain,
                );
                for (const step of next.descriptor.chain.steps) {
                  if (step.type === "nth") {
                    expect(Object.is(step.index, -0)).toBe(false);
                  }
                }
              } else if (next.descriptor.nth !== undefined) {
                expect(Object.is(next.descriptor.nth, -0)).toBe(false);
              }
              current = next;
            }

            const forkSnapshot = structuredClone(current.descriptor);
            let branchA = current;
            let branchB = current;
            for (const op of branchOps) {
              branchA = applyChainOp(branchA, op);
              branchB = applyChainOp(branchB, { type: "first" });
            }
            expect(current.descriptor).toStrictEqual(forkSnapshot);

            const serialized = serializeClientLocatorOptions("act", pageId, {
              locator: branchA,
              ignoreLocators: [current, branchB],
              timeout: 500,
            });
            expect(serialized.timeout).toBe(500);
            expect(serialized.ignoreLocators).toHaveLength(2);

            const serializedLoc = serializeClientLocator(branchA, pageId, "observe");
            if ("chain" in serializedLoc) {
              serializedLoc.chain.steps.push({ type: "nth", index: 999 });
              expect(branchA.descriptor).not.toEqual({ pageId, ...serializedLoc });
            }

            expect(client.calls).toHaveLength(0);
          },
        ),
        { seed: 4301, numRuns: 180 },
      );
    });

    it("rejects invalid nth indices, empty/whitespace selectors, and cross-page locators/masks", async () => {
      const invalidNthArb = fc.oneof(
        fc.integer({ min: -10_000, max: -1 }),
        fc.double({ min: 0.001, max: 100, noNaN: true }).filter((n) => !Number.isInteger(n)),
        fc.constantFrom(
          Number.NaN,
          Number.POSITIVE_INFINITY,
          Number.NEGATIVE_INFINITY,
          Number.MAX_SAFE_INTEGER + 1,
          1e25,
        ),
      );

      fc.assert(
        fc.property(invalidNthArb, (badIndex) => {
          const client = new ControllableCommandClient();
          const page = new Page(client, { pageId: "page-1" });
          const flat = page.locator("button");
          const chained = flat.locator("span");

          expect(() => flat.nth(badIndex)).toThrow();
          expect(() => chained.nth(badIndex)).toThrow();
          expect(client.calls).toHaveLength(0);
        }),
        { seed: 4302, numRuns: 100 },
      );

      const client = new ControllableCommandClient();
      const pageA = new Page(client, { pageId: "page-a" });
      const pageB = new Page(client, { pageId: "page-b" });

      for (const badSelector of ["", " ", "\t\n"]) {
        expect(() => pageA.locator(badSelector)).toThrow();
        expect(() => pageA.locator("div").locator(badSelector)).toThrow();
      }
      for (const badChained of [">>", "css=", 'text=""', "text=   "]) {
        expect(() => pageA.locator("div").locator(badChained)).toThrow();
      }

      const locA = pageA.locator("button");
      const locB = pageB.locator("button");
      expect(() => serializeClientLocatorOptions("act", "page-a", { locator: locB })).toThrow(
        "act(): locator must belong to the target page",
      );
      expect(() =>
        serializeClientLocatorOptions("extract", "page-a", { ignoreLocators: [locA, locB] }),
      ).toThrow("extract(): locator must belong to the target page");

      await expect(pageA.screenshot({ mask: [locB] })).rejects.toThrow(
        "mask locators must belong to the target page",
      );
      expect(client.calls).toHaveLength(0);
    });
  });

  describe("stateful Page subscriptions & listener lifecycle", () => {
    it("maintains zero leaked listeners and retries failed unsubscribes across arbitrary command interleavings", async () => {
      type SubAction =
        | {
            kind: "subscribe";
            event: "console" | "response" | "toolsadded" | "toolsremoved";
            pageOnFails: boolean;
            cleanupFails: boolean;
            listenerMode:
              | "ok"
              | "sync-throw"
              | "async-reject"
              | "fn-thenable-reject"
              | "self-unsub";
          }
        | { kind: "emit"; targetIndex: number; matching: boolean }
        | {
            kind: "unsubscribe";
            targetIndex: number;
            pageOffFails: boolean;
            concurrentCalls: number;
          }
        | { kind: "close" };

      const actionArb: fc.Arbitrary<SubAction> = fc.oneof(
        fc.record({
          kind: fc.constant("subscribe" as const),
          event: fc.constantFrom("console", "response", "toolsadded", "toolsremoved"),
          pageOnFails: fc.boolean(),
          cleanupFails: fc.boolean(),
          listenerMode: fc.constantFrom(
            "ok",
            "sync-throw",
            "async-reject",
            "fn-thenable-reject",
            "self-unsub",
          ),
        }),
        fc.record({
          kind: fc.constant("emit" as const),
          targetIndex: fc.integer({ min: 0, max: 5 }),
          matching: fc.boolean(),
        }),
        fc.record({
          kind: fc.constant("unsubscribe" as const),
          targetIndex: fc.integer({ min: 0, max: 5 }),
          pageOffFails: fc.boolean(),
          concurrentCalls: fc.integer({ min: 1, max: 3 }),
        }),
        fc.constant({ kind: "close" as const }),
      );

      await fc.assert(
        fc.asyncProperty(fc.array(actionArb, { minLength: 1, maxLength: 16 }), async (actions) => {
          let nextPageOnError: Error | null = null;
          let nextPageOffError: Error | null = null;
          const pageOffIds: string[] = [];

          const client = new ControllableCommandClient((method, params) => {
            if (method.name === StagehandMethods.pageOn.name) {
              if (nextPageOnError) {
                const err = nextPageOnError;
                nextPageOnError = null;
                throw err;
              }
              return { ok: true };
            }
            if (method.name === StagehandMethods.pageOff.name) {
              pageOffIds.push((params as { subscriptionId: string }).subscriptionId);
              if (nextPageOffError) {
                const err = nextPageOffError;
                nextPageOffError = null;
                throw err;
              }
              return { ok: true };
            }
            if (method.name === StagehandMethods.pageClose.name) {
              return { closed: true };
            }
            return { ok: true };
          });

          const page = new Page(client, { pageId: "p-1" });
          type TrackedSub = {
            sub: CDPSubscription;
            id: string;
            event: "console" | "response" | "toolsadded" | "toolsremoved";
            listenerMode:
              | "ok"
              | "sync-throw"
              | "async-reject"
              | "fn-thenable-reject"
              | "self-unsub";
            deliveries: number;
            locallyStopped: boolean;
            remotelyDisposed: boolean;
          };
          const tracked: TrackedSub[] = [];
          const pendingRemoteCleanupIds = new Set<string>();

          const makeListener = (
            mode: "ok" | "sync-throw" | "async-reject" | "fn-thenable-reject" | "self-unsub",
            getEntry: () => TrackedSub | undefined,
          ) => {
            return () => {
              const entry = getEntry();
              if (entry) {
                expect(entry.locallyStopped).toBe(false);
                entry.deliveries += 1;
              }
              switch (mode) {
                case "ok":
                  return undefined;
                case "sync-throw":
                  throw new Error("sync-listener-boom");
                case "async-reject":
                  return Promise.reject(new Error("async-listener-boom"));
                case "fn-thenable-reject": {
                  const fn = () => {};
                  const thenKey = ["th", "en"].join("");
                  Object.defineProperty(fn, thenKey, {
                    value: (_resolve: unknown, reject: (err: unknown) => void) => {
                      reject(new Error("fn-thenable-boom"));
                    },
                  });
                  return fn;
                }
                case "self-unsub": {
                  if (entry) {
                    entry.locallyStopped = true;
                    void entry.sub.unsubscribe().then(() => {
                      entry.remotelyDisposed = true;
                    });
                  }
                  return undefined;
                }
                default: {
                  const exhaustive: never = mode;
                  return exhaustive;
                }
              }
            };
          };

          for (const action of actions) {
            switch (action.kind) {
              case "subscribe": {
                nextPageOnError = action.pageOnFails ? new Error("pageOn failed") : null;
                nextPageOffError =
                  action.pageOnFails && action.cleanupFails ? new Error("cleanup failed") : null;
                let entry: TrackedSub | undefined;
                const listener = makeListener(action.listenerMode, () => entry);
                const callIdx = client.calls.length;
                const promise =
                  action.event === "console"
                    ? page.onConsole(listener)
                    : action.event === "response"
                      ? page.onResponse(listener)
                      : action.event === "toolsadded"
                        ? page.onToolsAdded(listener)
                        : page.onToolsRemoved(listener);

                if (action.pageOnFails) {
                  await expect(promise).rejects.toThrow("pageOn failed");
                  const failedSubId = (client.calls[callIdx]!.params as { subscriptionId: string })
                    .subscriptionId;
                  if (action.cleanupFails) {
                    pendingRemoteCleanupIds.add(failedSubId);
                  }
                } else {
                  const sub = await promise;
                  const subId = (client.calls[callIdx]!.params as { subscriptionId: string })
                    .subscriptionId;
                  entry = {
                    sub,
                    id: subId,
                    event: action.event,
                    listenerMode: action.listenerMode,
                    deliveries: 0,
                    locallyStopped: false,
                    remotelyDisposed: false,
                  };
                  tracked.push(entry);
                }
                break;
              }
              case "emit": {
                if (tracked.length === 0) break;
                const target = tracked[action.targetIndex % tracked.length]!;
                const subId = action.matching ? target.id : "unrelated-sub-id";
                const before = target.deliveries;
                const warningsBefore = client.warnings.length;
                const wasLocallyStopped = target.locallyStopped;

                if (target.event === "console") {
                  client.emit({
                    jsonrpc: "2.0",
                    method: StagehandNotifications.pageCDPEvent.name,
                    params: {
                      subscriptionId: subId,
                      event: {
                        pageId: "p-1",
                        method: "Runtime.consoleAPICalled",
                        params: { type: "log" },
                        sessionId: "s-1",
                        targetId: "t-1",
                      },
                    },
                  });
                } else if (target.event === "response") {
                  client.emit({
                    jsonrpc: "2.0",
                    method: StagehandNotifications.pageEvent.name,
                    params: {
                      subscriptionId: subId,
                      pageId: "p-1",
                      sessionId: "s-1",
                      targetId: "t-1",
                      event: "response",
                      response: {
                        responseId: "r-1",
                        url: "https://example.test/",
                        status: 200,
                        statusText: "OK",
                        headers: {},
                        fromServiceWorker: false,
                      },
                    },
                  });
                } else if (target.event === "toolsadded") {
                  client.emit({
                    jsonrpc: "2.0",
                    method: StagehandNotifications.pageEvent.name,
                    params: {
                      subscriptionId: subId,
                      pageId: "p-1",
                      sessionId: "s-1",
                      targetId: "t-1",
                      event: "toolsadded",
                      tools: [
                        {
                          name: "search",
                          description: "Search",
                          frameId: "f-1",
                        },
                      ],
                    },
                  });
                } else {
                  client.emit({
                    jsonrpc: "2.0",
                    method: StagehandNotifications.pageEvent.name,
                    params: {
                      subscriptionId: subId,
                      pageId: "p-1",
                      sessionId: "s-1",
                      targetId: "t-1",
                      event: "toolsremoved",
                      tools: [{ name: "search", frameId: "f-1" }],
                    },
                  });
                }
                await Promise.resolve();
                await Promise.resolve();
                if (action.matching && !wasLocallyStopped) {
                  expect(target.deliveries).toBe(before + 1);
                  if (
                    target.listenerMode === "sync-throw" ||
                    target.listenerMode === "async-reject" ||
                    target.listenerMode === "fn-thenable-reject"
                  ) {
                    expect(client.warnings.length).toBe(warningsBefore + 1);
                    expect(client.warnings.at(-1)?.code).toBe(
                      "STAGEHAND_PAGE_EVENT_LISTENER_ERROR",
                    );
                  }
                } else {
                  expect(target.deliveries).toBe(before);
                }
                break;
              }
              case "unsubscribe": {
                if (tracked.length === 0) break;
                const target = tracked[action.targetIndex % tracked.length]!;
                const offBefore = pageOffIds.length;
                if (!target.remotelyDisposed && action.pageOffFails) {
                  nextPageOffError = new Error("transient pageOff error");
                }
                target.locallyStopped = true;
                const results = await Promise.allSettled(
                  Array.from({ length: action.concurrentCalls }, () => target.sub.unsubscribe()),
                );
                if (target.remotelyDisposed) {
                  expect(results.every((r) => r.status === "fulfilled")).toBe(true);
                  expect(pageOffIds.length).toBe(offBefore);
                } else if (action.pageOffFails) {
                  expect(results.every((r) => r.status === "rejected")).toBe(true);
                  expect(pageOffIds.length).toBe(offBefore + 1);
                } else {
                  expect(results.every((r) => r.status === "fulfilled")).toBe(true);
                  expect(pageOffIds.length).toBe(offBefore + 1);
                  target.remotelyDisposed = true;
                }
                break;
              }
              case "close": {
                nextPageOffError = null;
                const uncleanedIds = [
                  ...tracked.filter((t) => !t.remotelyDisposed).map((t) => t.id),
                  ...pendingRemoteCleanupIds,
                ];
                const offCountBefore = pageOffIds.length;
                await page.close();
                const closedOffIds = pageOffIds.slice(offCountBefore);
                for (const id of uncleanedIds) {
                  expect(closedOffIds).toContain(id);
                }
                for (const entry of tracked) {
                  entry.locallyStopped = true;
                  entry.remotelyDisposed = true;
                }
                pendingRemoteCleanupIds.clear();
                expect(client.listeners.size).toBe(0);
                break;
              }
              default: {
                const exhaustive: never = action;
                return exhaustive;
              }
            }
          }

          nextPageOffError = null;
          await page.close();
          expect(client.listeners.size).toBe(0);
        }),
        { seed: 4303, numRuns: 100 },
      );
    });
  });

  describe("concurrent commandClient & batch error/abort isolation", () => {
    it("isolates out-of-order concurrent resolutions, rejections, and abort cleanup with zero leaked pending entries", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(
            fc.record({
              op: fc.constantFrom("url", "title", "count", "readClipboard"),
              outcome: fc.constantFrom("resolve", "reject"),
              orderKey: fc.integer({ min: 0, max: 1000 }),
            }),
            { minLength: 2, maxLength: 12 },
          ),
          async (specs) => {
            const client = new ControllableCommandClient();
            const page = new Page(client, { pageId: "p-batch" });
            const context = new BrowserContext(client);
            const locator = page.locator("button").first();

            const promises = specs.map((spec, idx) => {
              switch (spec.op) {
                case "url":
                  return page.url().then(
                    (value) => ({ idx, status: "fulfilled" as const, value }),
                    (error: unknown) => ({ idx, status: "rejected" as const, error }),
                  );
                case "title":
                  return page.title().then(
                    (value) => ({ idx, status: "fulfilled" as const, value }),
                    (error: unknown) => ({ idx, status: "rejected" as const, error }),
                  );
                case "count":
                  return locator.count().then(
                    (value) => ({ idx, status: "fulfilled" as const, value }),
                    (error: unknown) => ({ idx, status: "rejected" as const, error }),
                  );
                case "readClipboard":
                  return context.clipboard.readText({ page }).then(
                    (value) => ({ idx, status: "fulfilled" as const, value }),
                    (error: unknown) => ({ idx, status: "rejected" as const, error }),
                  );
                default: {
                  const exhaustive: never = spec.op;
                  return exhaustive;
                }
              }
            });

            expect(client.pending.size).toBe(specs.length);

            const indexed = specs.map((spec, idx) => ({
              spec,
              idx,
              pending: [...client.pending.values()][idx]!,
            }));
            indexed.sort((a, b) => a.spec.orderKey - b.spec.orderKey);

            for (const { spec, idx, pending } of indexed) {
              if (spec.outcome === "reject") {
                pending.reject(new Error(`err-${idx}`));
              } else {
                const value = spec.op === "count" ? idx : `val-${idx}`;
                pending.resolve(value);
              }
            }

            const settled = await Promise.all(promises);
            expect(client.pending.size).toBe(0);

            for (let idx = 0; idx < specs.length; idx += 1) {
              const spec = specs[idx]!;
              const outcome = settled[idx]!;
              if (spec.outcome === "reject") {
                expect(outcome.status).toBe("rejected");
                if (outcome.status === "rejected") {
                  expect((outcome.error as Error).message).toBe(`err-${idx}`);
                }
              } else {
                expect(outcome.status).toBe("fulfilled");
                if (outcome.status === "fulfilled") {
                  expect(outcome.value).toBe(spec.op === "count" ? idx : `val-${idx}`);
                }
              }
            }
          },
        ),
        { seed: 4304, numRuns: 100 },
      );
    });

    it("propagates AbortController timeout to abortable command clients without leaking pending calls", async () => {
      vi.useFakeTimers();
      try {
        await fc.assert(
          fc.asyncProperty(
            fc.integer({ min: 10, max: 500 }),
            fc.integer({ min: 1, max: 5 }),
            async (timeoutMs, callCount) => {
              const controller = new AbortController();
              const pendingRejects = new Set<(err: unknown) => void>();
              const abortListener = () => {
                const snapshot = Array.from(pendingRejects);
                pendingRejects.clear();
                for (const reject of snapshot) {
                  reject(controller.signal.reason);
                }
              };
              controller.signal.addEventListener("abort", abortListener, { once: true });

              const client: StagehandCommandClient = {
                send<Method extends RPCMethod>() {
                  if (controller.signal.aborted) {
                    return Promise.reject(controller.signal.reason);
                  }
                  return new Promise<z.output<Method["result"]>>((_resolve, reject) => {
                    pendingRejects.add(reject);
                  });
                },
                onNotification: () => () => {},
              };

              const timer = setTimeout(() => {
                controller.abort(new Error(`batch timed out after ${timeoutMs}ms`));
              }, timeoutMs);

              try {
                const page = new Page(client, { pageId: "p-abort" });
                const inFlight = Array.from({ length: callCount }, () => page.url());
                const settledPromise = Promise.allSettled(inFlight);
                await vi.advanceTimersByTimeAsync(timeoutMs);
                const settled = await settledPromise;
                expect(pendingRejects.size).toBe(0);
                for (const result of settled) {
                  expect(result.status).toBe("rejected");
                  if (result.status === "rejected") {
                    expect((result.reason as Error).message).toBe(
                      `batch timed out after ${timeoutMs}ms`,
                    );
                  }
                }
                await expect(page.title()).rejects.toThrow(`batch timed out after ${timeoutMs}ms`);
              } finally {
                clearTimeout(timer);
                controller.signal.removeEventListener("abort", abortListener);
              }
            },
          ),
          { seed: 4305, numRuns: 40 },
        );
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("Response, BrowserClipboard, WebMCP & client schemas", () => {
    it("matches HTTP status ok(), case-insensitive headers, defensive copies, and body/text/json decoding", async () => {
      const asciiHeaderChars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ-".split("");
      const asciiHeaderNameArb = fc
        .array(fc.constantFrom(...asciiHeaderChars), {
          minLength: 1,
          maxLength: 16,
        })
        .map((chars) => chars.join(""));

      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 0, max: 699 }),
          fc.array(
            fc.record({
              name: asciiHeaderNameArb,
              value: fc.string({ maxLength: 24 }),
            }),
            { maxLength: 10 },
          ),
          asciiHeaderNameArb,
          fc.record({
            key: fc.string({ maxLength: 16 }),
            count: fc.integer({ min: -50, max: 50 }),
          }),
          fc.boolean(),
          async (status, rawHeaders, queryName, jsonPayload, includeBom) => {
            const jsonText = JSON.stringify(jsonPayload);
            const rawBytes = new TextEncoder().encode(jsonText);
            const bodyBytes = includeBom
              ? new Uint8Array([0xef, 0xbb, 0xbf, ...rawBytes])
              : rawBytes;
            const encodedBody = browserPlatform.encodeBase64(bodyBytes);

            const client = new ControllableCommandClient((method) => {
              if (method.name === StagehandMethods.responseHeadersArray.name) {
                return { headers: rawHeaders.map((h) => ({ ...h })) };
              }
              if (method.name === StagehandMethods.responseBody.name) {
                return { body: encodedBody, base64Encoded: true };
              }
              if (method.name === StagehandMethods.responseFinished.name) {
                return { error: null };
              }
              return { headers: {} };
            });

            const inputDescriptor: NavigationResponseDescriptor = {
              responseId: "resp-1",
              url: "https://example.test/item",
              status,
              statusText: "Status",
              headers: { "x-origin": "initial" },
              fromServiceWorker: false,
            };

            const response = new Response(client, inputDescriptor);
            inputDescriptor.headers["x-origin"] = "mutated";
            expect(response.headers()).toStrictEqual({ "x-origin": "initial" });
            expect(response.ok()).toBe(status >= 200 && status <= 299);

            const expectedValues = rawHeaders
              .filter((h: NavigationHeader) => h.name.toLowerCase() === queryName.toLowerCase())
              .map((h) => h.value);
            const toggledQuery = queryName
              .split("")
              .map((ch, idx) => (idx % 2 === 0 ? ch.toUpperCase() : ch.toLowerCase()))
              .join("");

            await expect(response.headerValues(toggledQuery)).resolves.toStrictEqual(
              expectedValues,
            );
            await expect(response.headerValue(toggledQuery)).resolves.toBe(
              expectedValues.length === 0 ? null : expectedValues.join(", "),
            );

            await expect(response.body()).resolves.toStrictEqual(bodyBytes);
            await expect(response.text()).resolves.toBe(jsonText);
            await expect(response.json()).resolves.toEqual(jsonPayload);
            await expect(response.finished()).resolves.toBeNull();
          },
        ),
        { seed: 4306, numRuns: 120 },
      );
    });

    it("forwards all BrowserClipboard methods with exact pageId and shortcut semantics", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ maxLength: 40 }),
          fc.boolean(),
          fc.option(fc.constantFrom("Control+V", "Meta+V", "ControlOrMeta+V"), {
            nil: undefined,
          }),
          async (text, withPage, shortcut) => {
            const client = new ControllableCommandClient((method) =>
              method.name === StagehandMethods.contextClipboardReadText.name ? text : { ok: true },
            );
            const clipboard = new BrowserClipboard(client);
            const page = new Page(client, { pageId: "p-clip" });
            const opts = withPage ? { page } : undefined;

            await expect(clipboard.readText(opts)).resolves.toBe(text);
            await clipboard.writeText(text, opts);
            await clipboard.clear(opts);
            await clipboard.paste({
              ...opts,
              ...(shortcut === undefined ? {} : { shortcut }),
            });
            await clipboard.copy(opts);
            await clipboard.cut(opts);

            const expectedTarget = withPage ? { pageId: "p-clip" } : {};
            expect(client.calls).toStrictEqual([
              { method: StagehandMethods.contextClipboardReadText.name, params: expectedTarget },
              {
                method: StagehandMethods.contextClipboardWriteText.name,
                params: { text, ...expectedTarget },
              },
              { method: StagehandMethods.contextClipboardClear.name, params: expectedTarget },
              {
                method: StagehandMethods.contextClipboardPaste.name,
                params: {
                  ...expectedTarget,
                  ...(shortcut === undefined ? {} : { shortcut }),
                },
              },
              { method: StagehandMethods.contextClipboardCopy.name, params: expectedTarget },
              { method: StagehandMethods.contextClipboardCut.name, params: expectedTarget },
            ]);
          },
        ),
        { seed: 4307, numRuns: 80 },
      );
    });

    it("isolates WebMCPTool descriptors, validates invoke options, caches terminal invocation results, and retries transient failures", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 1, maxLength: 20 }),
          fc.string({ minLength: 1, maxLength: 20 }),
          fc.option(fc.string({ minLength: 1, maxLength: 16 }), { nil: undefined }),
          fc.dictionary(
            fc.string({ minLength: 1, maxLength: 12 }),
            fc.integer({ min: -10, max: 10 }),
            {
              maxKeys: 4,
            },
          ),
          async (toolName, frameId, toolId, inputArgs) => {
            let resultAttempt = 0;
            const terminal: WebMCPToolResponse = {
              invocationId: "inv-1",
              status: "Completed",
              output: { ok: true },
            };

            const client = new ControllableCommandClient((method) => {
              if (method.name === StagehandMethods.pageWebMCPInvokeTool.name) {
                return {
                  invocationId: "inv-1",
                  toolName,
                  frameId,
                  input: { ...inputArgs },
                };
              }
              if (method.name === StagehandMethods.pageWebMCPInvocationResult.name) {
                resultAttempt += 1;
                if (resultAttempt === 1) {
                  throw new Error("transient timeout");
                }
                return terminal;
              }
              return { ok: true };
            });

            const descriptor: WebMCPToolDescriptor = {
              ...(toolId === undefined ? {} : { toolId }),
              name: toolName,
              description: "Test tool",
              frameId,
              inputSchema: { type: "object", properties: { a: { type: "number" } } },
              annotations: { readOnly: true },
            };

            const tool = new WebMCPTool(client, "p-mcp", descriptor);
            descriptor.annotations!.readOnly = false;
            descriptor.inputSchema!.type = "mutated";
            expect(tool.annotations?.readOnly).toBe(true);
            expect(tool.inputSchema?.type).toBe("object");

            await expect(tool.invoke({ input: null as never })).rejects.toThrow();
            await expect(tool.invoke({ input: { bad: 1n } as never })).rejects.toThrow();

            const plainInputArgs = { ...inputArgs };
            const invocation = await tool.invoke({ input: plainInputArgs });
            expect(client.calls[0]).toStrictEqual({
              method: StagehandMethods.pageWebMCPInvokeTool.name,
              params: {
                pageId: "p-mcp",
                frameId,
                toolName,
                ...(toolId === undefined ? {} : { toolId }),
                input: plainInputArgs,
              },
            });

            await expect(invocation.result({ timeout: 5 })).rejects.toThrow("transient timeout");
            const firstSuccess = await invocation.result({ timeout: 500 });
            const cached = await invocation.result({ timeout: 1 });
            expect(cached).toBe(firstSuccess);
            expect(resultAttempt).toBe(2);

            await invocation.cancel();
            expect(client.calls.at(-1)).toStrictEqual({
              method: StagehandMethods.pageWebMCPCancelInvocation.name,
              params: { pageId: "p-mcp", invocationId: "inv-1" },
            });
          },
        ),
        { seed: 4308, numRuns: 80 },
      );
    });

    it("enforces client option schemas with real Page/Locator instances and rejects spoofed plain objects", () => {
      const client = new ControllableCommandClient();
      const page = new Page(client, { pageId: "p-1" });
      const locator = page.locator("main");

      for (const schema of [
        StagehandClientActOptionsSchema,
        StagehandClientObserveOptionsSchema,
        StagehandClientExtractOptionsSchema,
      ]) {
        expect(schema.safeParse({ page, locator, ignoreLocators: [locator] }).success).toBe(true);
        expect(schema.safeParse({ page: { pageId: "p-1" } }).success).toBe(false);
        expect(schema.safeParse({ locator: { descriptor: locator.descriptor } }).success).toBe(
          false,
        );
        expect(schema.safeParse({ unexpectedField: true }).success).toBe(false);
      }

      expect(WebMCPToolsOptionsSchema.safeParse({}).success).toBe(true);
      expect(WebMCPToolsOptionsSchema.safeParse({ timeout: -1 }).success).toBe(false);
      expect(WebMCPInvokeOptionsSchema.safeParse({}).success).toBe(true);
      expect(WebMCPInvokeOptionsSchema.safeParse({ input: { ok: 1 } }).success).toBe(true);
      expect(WebMCPInvokeOptionsSchema.safeParse({ input: null }).success).toBe(false);
      expect(WebMCPResultOptionsSchema.safeParse({ timeout: 100 }).success).toBe(true);
      expect(WebMCPResultOptionsSchema.safeParse({ timeout: -5 }).success).toBe(false);
    });
  });
});
