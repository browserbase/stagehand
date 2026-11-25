import type { Protocol } from "devtools-protocol";
import fc from "fast-check";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CDPSessionLike } from "./cdp.js";
import { NetworkManager } from "./networkManager.js";
import type { Page } from "./page.js";
import type { Response } from "./response.js";
import { SessionNetworkCapture } from "./sessionNetworkCapture.js";
import { IGNORED_RESOURCE_TYPES } from "../types/private/network.js";

const SESSION_IDS = ["main", "child-a", "child-b"] as const;
type SessionId = (typeof SESSION_IDS)[number];

const REQUEST_IDS = ["req-1", "req-2", "req-3", "req-4"] as const;
const FRAME_IDS = ["main-frame", "child-a-frame", "child-b-frame"] as const;
const LOADER_IDS = ["req-1", "req-2", "loader-a", "loader-b"] as const;
const RESOURCE_TYPES: readonly Protocol.Network.ResourceType[] = [
  "Document",
  "Fetch",
  "XHR",
  "Script",
  "WebSocket",
  "EventSource",
];

class MockSession implements CDPSessionLike {
  readonly handlers = new Map<string, Set<(event: unknown) => void>>();

  constructor(readonly id: string) {}

  async send<R = unknown>(method: string): Promise<R> {
    if (method === "Network.getResponseBody") {
      return { body: `body:${this.id}`, base64Encoded: false } as R;
    }
    return {} as R;
  }

  on<P = unknown>(event: string, handler: (params: P) => void): void {
    const set = this.handlers.get(event) ?? new Set<(event: unknown) => void>();
    set.add(handler as (event: unknown) => void);
    this.handlers.set(event, set);
  }

  off<P = unknown>(event: string, handler: (params: P) => void): void {
    this.handlers.get(event)?.delete(handler as (event: unknown) => void);
  }

  emit(event: string, payload: unknown): void {
    const snapshot = [...(this.handlers.get(event) ?? [])];
    for (const handler of snapshot) {
      handler(payload);
    }
  }

  listenerCount(): number {
    let total = 0;
    for (const set of this.handlers.values()) total += set.size;
    return total;
  }

  async close(): Promise<void> {}
}

type NetworkCommand =
  | {
      kind: "requestWillBeSent";
      session: SessionId;
      requestId: string;
      frameId: string;
      loaderId: string;
      resourceType: Protocol.Network.ResourceType;
      redirect: boolean;
      dataUrl: boolean;
    }
  | {
      kind: "requestWillBeSentExtraInfo";
      session: SessionId;
      requestId: string;
      headerValue: string;
    }
  | {
      kind: "responseReceived";
      session: SessionId;
      requestId: string;
      frameId: string;
      loaderId: string;
      resourceType: Protocol.Network.ResourceType;
      status: number;
      dataUrl: boolean;
    }
  | {
      kind: "responseReceivedExtraInfo";
      session: SessionId;
      requestId: string;
      statusCode: number;
      headerValue: string;
    }
  | {
      kind: "loadingFinished";
      session: SessionId;
      requestId: string;
    }
  | {
      kind: "loadingFailed";
      session: SessionId;
      requestId: string;
      errorText: string;
    }
  | {
      kind: "requestServedFromCache";
      session: SessionId;
      requestId: string;
    }
  | {
      kind: "frameStoppedLoading";
      session: SessionId;
      frameId: string;
    }
  | {
      kind: "frameNavigated";
      session: SessionId;
      frameId: string;
      loaderId: string;
    }
  | {
      kind: "trackSession";
      session: SessionId;
      withCapture: boolean;
      withChildFrame: boolean;
    }
  | {
      kind: "untrackSession";
      session: SessionId;
    }
  | {
      kind: "toggleResponseObserver";
      enabled: boolean;
    }
  | {
      kind: "advance";
      ms: number;
    };

const sessionArb = fc.constantFrom<SessionId>(...SESSION_IDS);
const requestIdArb = fc.constantFrom<string>(...REQUEST_IDS);
const frameIdArb = fc.constantFrom<string>(...FRAME_IDS);
const loaderIdArb = fc.constantFrom<string>(...LOADER_IDS);
const resourceTypeArb = fc.constantFrom<Protocol.Network.ResourceType>(...RESOURCE_TYPES);

const networkCommandArb: fc.Arbitrary<NetworkCommand> = fc.oneof(
  {
    weight: 6,
    arbitrary: fc.record({
      kind: fc.constant("requestWillBeSent" as const),
      session: sessionArb,
      requestId: requestIdArb,
      frameId: frameIdArb,
      loaderId: loaderIdArb,
      resourceType: resourceTypeArb,
      redirect: fc.boolean(),
      dataUrl: fc.boolean(),
    }),
  },
  {
    weight: 2,
    arbitrary: fc.record({
      kind: fc.constant("requestWillBeSentExtraInfo" as const),
      session: sessionArb,
      requestId: requestIdArb,
      headerValue: fc.constantFrom("v1", "v2", "v3"),
    }),
  },
  {
    weight: 5,
    arbitrary: fc.record({
      kind: fc.constant("responseReceived" as const),
      session: sessionArb,
      requestId: requestIdArb,
      frameId: frameIdArb,
      loaderId: loaderIdArb,
      resourceType: resourceTypeArb,
      status: fc.constantFrom(200, 302, 404, 500),
      dataUrl: fc.boolean(),
    }),
  },
  {
    weight: 3,
    arbitrary: fc.record({
      kind: fc.constant("responseReceivedExtraInfo" as const),
      session: sessionArb,
      requestId: requestIdArb,
      statusCode: fc.constantFrom(200, 302, 404),
      headerValue: fc.constantFrom("hdr-a", "hdr-b", "hdr-c"),
    }),
  },
  {
    weight: 5,
    arbitrary: fc.record({
      kind: fc.constant("loadingFinished" as const),
      session: sessionArb,
      requestId: requestIdArb,
    }),
  },
  {
    weight: 4,
    arbitrary: fc.record({
      kind: fc.constant("loadingFailed" as const),
      session: sessionArb,
      requestId: requestIdArb,
      errorText: fc.constantFrom("net::ERR_FAILED", "net::ERR_ABORTED", ""),
    }),
  },
  {
    weight: 2,
    arbitrary: fc.record({
      kind: fc.constant("requestServedFromCache" as const),
      session: sessionArb,
      requestId: requestIdArb,
    }),
  },
  {
    weight: 2,
    arbitrary: fc.record({
      kind: fc.constant("frameStoppedLoading" as const),
      session: sessionArb,
      frameId: frameIdArb,
    }),
  },
  {
    weight: 3,
    arbitrary: fc.record({
      kind: fc.constant("frameNavigated" as const),
      session: sessionArb,
      frameId: frameIdArb,
      loaderId: loaderIdArb,
    }),
  },
  {
    weight: 2,
    arbitrary: fc.record({
      kind: fc.constant("trackSession" as const),
      session: sessionArb,
      withCapture: fc.boolean(),
      withChildFrame: fc.boolean(),
    }),
  },
  {
    weight: 2,
    arbitrary: fc.record({
      kind: fc.constant("untrackSession" as const),
      session: sessionArb,
    }),
  },
  {
    weight: 1,
    arbitrary: fc.record({
      kind: fc.constant("toggleResponseObserver" as const),
      enabled: fc.boolean(),
    }),
  },
  {
    weight: 2,
    arbitrary: fc.record({
      kind: fc.constant("advance" as const),
      ms: fc.integer({ min: 1, max: 60 }),
    }),
  },
);

function childFrameFor(sessionId: SessionId): string | undefined {
  switch (sessionId) {
    case "main":
      return undefined;
    case "child-a":
      return "child-a-frame";
    case "child-b":
      return "child-b-frame";
    default: {
      const exhaustive: never = sessionId;
      throw new Error(`Unhandled sessionId: ${String(exhaustive)}`);
    }
  }
}

function assertManagerInvariants(manager: NetworkManager): void {
  const expectedUnfinishedBySession = new Map<string, Set<string>>();
  for (const [sid, tracked] of manager.sessions) {
    expectedUnfinishedBySession.set(sid, new Set());
    for (const [reqId, info] of tracked.unfinishedRequests) {
      expect(info.requestId).toBe(reqId);
      expect(info.sessionId).toBe(sid);
      expect(manager.requests.get(info.requestKey)).toBe(info);
    }
  }
  for (const [key, info] of manager.requests) {
    expect(manager.sessions.has(info.sessionId)).toBe(true);
    expect(key).toBe(`${info.sessionId}:${info.requestId}`);
    expect(manager.sessions.get(info.sessionId)?.unfinishedRequests.get(info.requestId)).toBe(info);
    expectedUnfinishedBySession.get(info.sessionId)?.add(info.requestId);
  }
  for (const [sid, tracked] of manager.sessions) {
    expect(new Set(tracked.unfinishedRequests.keys())).toEqual(
      expectedUnfinishedBySession.get(sid),
    );
  }
  for (const [frameId, requestKey] of manager.documentRequestsByFrame) {
    const info = manager.requests.get(requestKey);
    expect(info).toBeDefined();
    expect(info?.documentRequest).toBe(true);
    expect(info?.frameId).toBe(frameId);
  }
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  try {
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  }
});

describe("NetworkManager stateful properties", () => {
  it("maintains strict map invariants, terminal-event discipline, and leak-free disposal under arbitrary CDP interleavings", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(networkCommandArb, { minLength: 1, maxLength: 60 }),
        async (commands) => {
          vi.useFakeTimers();
          vi.setSystemTime(10_000);

          const sessions: Record<SessionId, MockSession> = {
            main: new MockSession("main"),
            "child-a": new MockSession("child-a"),
            "child-b": new MockSession("child-b"),
          };
          const manager = new NetworkManager({} as Page);
          manager.trackSession(sessions.main);

          const activeRequests = new Set<string>();
          const emittedResponses: Response[] = [];
          let removeResponseObserver: (() => void) | null = manager.subscribeResponse((r) => {
            emittedResponses.push(r);
          });

          manager.addObserver({
            onRequestStarted: (info) => {
              activeRequests.add(info.requestKey);
            },
            onRequestFinished: (info) => {
              expect(activeRequests.has(info.requestKey)).toBe(true);
              activeRequests.delete(info.requestKey);
            },
            onRequestFailed: (info) => {
              expect(activeRequests.has(info.requestKey)).toBe(true);
              activeRequests.delete(info.requestKey);
            },
          });

          try {
            for (const cmd of commands) {
              switch (cmd.kind) {
                case "requestWillBeSent": {
                  const url = cmd.dataUrl
                    ? `data:text/html,${cmd.requestId}`
                    : `https://example.test/${cmd.requestId}/${cmd.redirect ? "final" : "start"}`;
                  sessions[cmd.session].emit("Network.requestWillBeSent", {
                    requestId: cmd.requestId,
                    frameId: cmd.frameId,
                    loaderId: cmd.loaderId,
                    type: cmd.resourceType,
                    request: { url },
                    ...(cmd.redirect
                      ? {
                          redirectResponse: {
                            url: `https://example.test/${cmd.requestId}/start`,
                            status: 302,
                            statusText: "Found",
                            headers: {},
                          },
                        }
                      : {}),
                  });
                  break;
                }
                case "requestWillBeSentExtraInfo": {
                  sessions[cmd.session].emit("Network.requestWillBeSentExtraInfo", {
                    requestId: cmd.requestId,
                    associatedCookies: [],
                    headers: { "x-req-extra": cmd.headerValue },
                  });
                  break;
                }
                case "responseReceived": {
                  const url = cmd.dataUrl
                    ? `data:text/plain,${cmd.requestId}`
                    : `https://example.test/${cmd.requestId}`;
                  sessions[cmd.session].emit("Network.responseReceived", {
                    requestId: cmd.requestId,
                    frameId: cmd.frameId,
                    loaderId: cmd.loaderId,
                    type: cmd.resourceType,
                    response: {
                      url,
                      status: cmd.status,
                      statusText: "OK",
                      headers: { "x-base": "1" },
                    },
                  });
                  break;
                }
                case "responseReceivedExtraInfo": {
                  sessions[cmd.session].emit("Network.responseReceivedExtraInfo", {
                    requestId: cmd.requestId,
                    blockedCookies: [],
                    headers: { "x-extra": cmd.headerValue },
                    resourceIPAddressSpace: "Public",
                    statusCode: cmd.statusCode,
                  });
                  break;
                }
                case "loadingFinished": {
                  sessions[cmd.session].emit("Network.loadingFinished", {
                    requestId: cmd.requestId,
                  });
                  break;
                }
                case "loadingFailed": {
                  sessions[cmd.session].emit("Network.loadingFailed", {
                    requestId: cmd.requestId,
                    errorText: cmd.errorText,
                  });
                  break;
                }
                case "requestServedFromCache": {
                  sessions[cmd.session].emit("Network.requestServedFromCache", {
                    requestId: cmd.requestId,
                  });
                  break;
                }
                case "frameStoppedLoading": {
                  sessions[cmd.session].emit("Page.frameStoppedLoading", {
                    frameId: cmd.frameId,
                  });
                  break;
                }
                case "frameNavigated": {
                  sessions[cmd.session].emit("Page.frameNavigated", {
                    frame: { id: cmd.frameId, loaderId: cmd.loaderId },
                  });
                  break;
                }
                case "trackSession": {
                  const targetSession = sessions[cmd.session];
                  const childFrame = cmd.withChildFrame ? childFrameFor(cmd.session) : undefined;
                  if (manager.sessions.has(cmd.session)) {
                    manager.trackSession(targetSession, undefined, childFrame);
                  } else if (cmd.withCapture) {
                    const capture = new SessionNetworkCapture(targetSession);
                    manager.trackSession(targetSession, capture, childFrame);
                  } else {
                    manager.trackSession(targetSession, undefined, childFrame);
                  }
                  break;
                }
                case "untrackSession": {
                  manager.untrackSession(cmd.session);
                  for (const key of activeRequests) {
                    if (!manager.requests.has(key)) activeRequests.delete(key);
                  }
                  break;
                }
                case "toggleResponseObserver": {
                  if (cmd.enabled && !removeResponseObserver) {
                    removeResponseObserver = manager.subscribeResponse((r) => {
                      emittedResponses.push(r);
                    });
                  } else if (!cmd.enabled && removeResponseObserver) {
                    removeResponseObserver();
                    removeResponseObserver = null;
                  }
                  break;
                }
                case "advance": {
                  vi.advanceTimersByTime(cmd.ms);
                  break;
                }
                default: {
                  const exhaustive: never = cmd;
                  throw new Error(`Unhandled command: ${String(exhaustive)}`);
                }
              }

              assertManagerInvariants(manager);
              expect(activeRequests).toEqual(new Set(manager.requests.keys()));
            }

            // Drain only requests the start/finish observer model still considers in-flight;
            // requests already settled (e.g. requestServedFromCache, data:, loadingFinished)
            // must already be absent from manager.requests and tracked.unfinishedRequests.
            const remainingBySession = new Map<SessionId, string[]>();
            for (const key of activeRequests) {
              const sep = key.indexOf(":");
              const sid = key.slice(0, sep) as SessionId;
              const reqId = key.slice(sep + 1);
              const list = remainingBySession.get(sid) ?? [];
              list.push(reqId);
              remainingBySession.set(sid, list);
            }
            for (const [sid, tracked] of manager.sessions) {
              expect(new Set(tracked.unfinishedRequests.keys())).toEqual(
                new Set(remainingBySession.get(sid as SessionId) ?? []),
              );
            }
            for (const [sid, reqIds] of remainingBySession) {
              if (!manager.sessions.has(sid)) continue;
              for (const reqId of reqIds) {
                sessions[sid].emit("Network.loadingFinished", { requestId: reqId });
              }
            }
            for (const response of emittedResponses) {
              if (response.finishedSettled) continue;
              const sid = response.session.id as SessionId;
              if (!manager.sessions.has(sid)) continue;
              sessions[sid].emit("Network.loadingFinished", { requestId: response.requestId });
            }
            await Promise.resolve();

            assertManagerInvariants(manager);
            expect(manager.requests.size).toBe(0);
            expect(manager.documentRequestsByFrame.size).toBe(0);
            for (const tracked of manager.sessions.values()) {
              expect(tracked.unfinishedRequests.size).toBe(0);
            }
            for (const response of emittedResponses) {
              expect(response.finishedSettled).toBe(true);
            }

            manager.dispose();
            expect(manager.sessions.size).toBe(0);
            expect(manager.requests.size).toBe(0);
            expect(manager.documentRequestsByFrame.size).toBe(0);
            expect(manager.observers.size).toBe(0);
            for (const sid of SESSION_IDS) {
              expect(sessions[sid].listenerCount()).toBe(0);
            }
          } finally {
            manager.dispose();
            vi.clearAllTimers();
          }
        },
      ),
      { seed: 0x4e4d0001, numRuns: 150 },
    );
  });

  it("never leaks pendingDocumentCompletions across no-observer handoffs or duplicate child completions", () => {
    fc.assert(
      fc.property(
        fc.boolean(),
        fc.boolean(),
        fc.integer({ min: 1, max: 3 }),
        (withResponseObserver, failFirst, extraChildFinishes) => {
          const parent = new MockSession("parent");
          const child = new MockSession("child");
          const manager = new NetworkManager({} as Page);
          manager.trackSession(parent);
          manager.trackSession(child, undefined, "child-frame");

          const responses: Response[] = [];
          if (withResponseObserver) {
            manager.subscribeResponse((r) => responses.push(r));
          }

          parent.emit("Network.requestWillBeSent", {
            requestId: "doc-1",
            frameId: "child-frame",
            loaderId: "doc-1",
            type: "Document",
            request: { url: "https://example.test/doc-1" },
          });
          parent.emit("Network.responseReceived", {
            requestId: "doc-1",
            frameId: "child-frame",
            loaderId: "doc-1",
            type: "Document",
            response: { url: "https://example.test/doc-1", status: 200, headers: {} },
          });

          for (let i = 0; i < extraChildFinishes; i += 1) {
            child.emit(failFirst ? "Network.loadingFailed" : "Network.loadingFinished", {
              requestId: "doc-1",
              errorText: "net::ERR_FAILED",
            });
          }

          const secondResponses: Response[] = [];
          manager.subscribeResponse((r) => secondResponses.push(r));
          parent.emit("Network.requestWillBeSent", {
            requestId: "doc-1",
            frameId: "child-frame",
            loaderId: "doc-1",
            type: "Document",
            request: { url: "https://example.test/doc-1-reused" },
          });
          parent.emit("Network.responseReceived", {
            requestId: "doc-1",
            frameId: "child-frame",
            loaderId: "doc-1",
            type: "Document",
            response: { url: "https://example.test/doc-1-reused", status: 200, headers: {} },
          });

          expect(secondResponses).toHaveLength(1);
          expect(secondResponses[0]!.finishedSettled).toBe(false);
          expect(manager.requests.has("parent:doc-1")).toBe(true);

          manager.dispose();
          expect(parent.listenerCount()).toBe(0);
          expect(child.listenerCount()).toBe(0);
        },
      ),
      { seed: 0x4e4d0002, numRuns: 60 },
    );
  });

  it("settles waitForIdle accurately across requests, session detach, and manager.dispose without timer leaks", async () => {
    type IdleCommand =
      | {
          kind: "start";
          session: "main" | "child";
          requestId: string;
          resourceType: Protocol.Network.ResourceType;
        }
      | { kind: "finish"; session: "main" | "child"; requestId: string }
      | { kind: "fail"; session: "main" | "child"; requestId: string }
      | { kind: "untrackChild" }
      | { kind: "retrackChild" }
      | { kind: "advance"; ms: number };

    const idleCmdArb: fc.Arbitrary<IdleCommand> = fc.oneof(
      {
        weight: 5,
        arbitrary: fc.record({
          kind: fc.constant("start" as const),
          session: fc.constantFrom("main" as const, "child" as const),
          requestId: fc.constantFrom("r1", "r2", "r3"),
          resourceType: resourceTypeArb,
        }),
      },
      {
        weight: 4,
        arbitrary: fc.record({
          kind: fc.constant("finish" as const),
          session: fc.constantFrom("main" as const, "child" as const),
          requestId: fc.constantFrom("r1", "r2", "r3"),
        }),
      },
      {
        weight: 3,
        arbitrary: fc.record({
          kind: fc.constant("fail" as const),
          session: fc.constantFrom("main" as const, "child" as const),
          requestId: fc.constantFrom("r1", "r2", "r3"),
        }),
      },
      { weight: 2, arbitrary: fc.constant<IdleCommand>({ kind: "untrackChild" }) },
      { weight: 1, arbitrary: fc.constant<IdleCommand>({ kind: "retrackChild" }) },
      {
        weight: 4,
        arbitrary: fc.record({
          kind: fc.constant("advance" as const),
          ms: fc.integer({ min: 1, max: 120 }),
        }),
      },
    );

    await fc.assert(
      fc.asyncProperty(
        fc.array(idleCmdArb, { minLength: 1, maxLength: 35 }),
        fc.integer({ min: 50, max: 200 }),
        fc.boolean(),
        async (commands, idleTimeMs, disposeMidFlight) => {
          vi.useFakeTimers();
          vi.setSystemTime(5_000);

          const main = new MockSession("main");
          const child = new MockSession("child");
          const manager = new NetworkManager({} as Page);
          manager.trackSession(main);
          manager.trackSession(child, undefined, "child-frame");

          const handle = manager.waitForIdle({
            startTime: 5_000,
            idleTimeMs,
            timeout: 20_000,
          });
          const statusBox: { current: "pending" | "resolved" | "rejected" } = {
            current: "pending",
          };
          void handle.promise.then(
            () => {
              statusBox.current = "resolved";
            },
            () => {
              statusBox.current = "rejected";
            },
          );

          const expectedInflight = new Set<string>();
          let quietSince: number | null = Date.now();
          let childTracked = true;

          const countFiltered = () => expectedInflight.size;

          try {
            for (const cmd of commands) {
              switch (cmd.kind) {
                case "start": {
                  const sess = cmd.session === "main" ? main : child;
                  sess.emit("Network.requestWillBeSent", {
                    requestId: cmd.requestId,
                    frameId: cmd.session === "main" ? "main-frame" : "child-frame",
                    loaderId: "loader-1",
                    type: cmd.resourceType,
                    request: { url: `https://example.test/${cmd.requestId}` },
                  });
                  if (
                    (cmd.session === "main" || childTracked) &&
                    !IGNORED_RESOURCE_TYPES.has(cmd.resourceType)
                  ) {
                    expectedInflight.add(`${cmd.session}:${cmd.requestId}`);
                    quietSince = null;
                  }
                  break;
                }
                case "finish": {
                  const sess = cmd.session === "main" ? main : child;
                  sess.emit("Network.loadingFinished", { requestId: cmd.requestId });
                  if (cmd.session === "main" || childTracked) {
                    if (
                      expectedInflight.delete(`${cmd.session}:${cmd.requestId}`) &&
                      expectedInflight.size === 0
                    ) {
                      quietSince = Date.now();
                    }
                  }
                  break;
                }
                case "fail": {
                  const sess = cmd.session === "main" ? main : child;
                  sess.emit("Network.loadingFailed", {
                    requestId: cmd.requestId,
                    errorText: "net::ERR_FAILED",
                  });
                  if (cmd.session === "main" || childTracked) {
                    if (
                      expectedInflight.delete(`${cmd.session}:${cmd.requestId}`) &&
                      expectedInflight.size === 0
                    ) {
                      quietSince = Date.now();
                    }
                  }
                  break;
                }
                case "untrackChild": {
                  manager.untrackSession("child");
                  if (childTracked) {
                    childTracked = false;
                    let removed = false;
                    for (const key of expectedInflight) {
                      if (key.startsWith("child:")) {
                        expectedInflight.delete(key);
                        removed = true;
                      }
                    }
                    if (removed && expectedInflight.size === 0) {
                      quietSince = Date.now();
                    }
                  }
                  break;
                }
                case "retrackChild": {
                  if (!childTracked) {
                    manager.trackSession(child, undefined, "child-frame");
                    childTracked = true;
                  }
                  break;
                }
                case "advance": {
                  await vi.advanceTimersByTimeAsync(cmd.ms);
                  break;
                }
                default: {
                  const exhaustive: never = cmd;
                  throw new Error(`Unhandled idle command: ${String(exhaustive)}`);
                }
              }

              await Promise.resolve();
              if (statusBox.current === "resolved") {
                expect(countFiltered()).toBe(0);
                break;
              }
              if (countFiltered() > 0) {
                expect(statusBox.current).toBe("pending");
              } else if (quietSince !== null && Date.now() - quietSince < idleTimeMs) {
                expect(statusBox.current).toBe("pending");
              }
            }

            if (disposeMidFlight) {
              manager.dispose();
              await Promise.resolve();
              expect(statusBox.current).not.toBe("pending");
              expect(vi.getTimerCount()).toBe(0);
            } else if (statusBox.current === "pending") {
              for (const reqId of ["r1", "r2", "r3"]) {
                main.emit("Network.loadingFinished", { requestId: reqId });
                if (childTracked) child.emit("Network.loadingFinished", { requestId: reqId });
              }
              await vi.advanceTimersByTimeAsync(idleTimeMs - 1);
              if (expectedInflight.size > 0) {
                expect(statusBox.current).toBe("pending");
              }
              await vi.advanceTimersByTimeAsync(1);
              expect(statusBox.current).toBe("resolved");
              expect(vi.getTimerCount()).toBe(0);
              manager.dispose();
            } else {
              manager.dispose();
              expect(vi.getTimerCount()).toBe(0);
            }
          } finally {
            manager.dispose();
            vi.clearAllTimers();
          }
        },
      ),
      { seed: 0x4e4d0003, numRuns: 150 },
    );
  });

  it("cleans up replaced-document unfinishedRequests and pendingResponses even after frameStoppedLoading", async () => {
    const manager = new NetworkManager({} as Page);
    const session = new MockSession("main");
    manager.trackSession(session);
    const responses: Response[] = [];
    manager.subscribeResponse((r) => responses.push(r));

    session.emit("Network.requestWillBeSent", {
      requestId: "doc-1",
      frameId: "main-frame",
      loaderId: "loader-1",
      type: "Document",
      request: { url: "https://example.test/page-1" },
    });
    session.emit("Network.responseReceived", {
      requestId: "doc-1",
      frameId: "main-frame",
      loaderId: "loader-1",
      type: "Document",
      response: { url: "https://example.test/page-1", status: 200, headers: {} },
    });
    session.emit("Page.frameStoppedLoading", { frameId: "main-frame" });
    session.emit("Page.frameNavigated", {
      frame: { id: "main-frame", loaderId: "loader-2" },
    });

    expect(manager.sessions.get("main")?.unfinishedRequests.size).toBe(0);
    expect(responses[0]!.finishedSettled).toBe(true);
    await expect(responses[0]!.finished()).resolves.toBeInstanceOf(Error);
    manager.dispose();
    expect(session.listenerCount()).toBe(0);
  });

  it("correlates cross-session OOPIF handoff and redirect extraInfo regardless of capture attach order", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.boolean(),
        fc.boolean(),
        fc.boolean(),
        async (childAttachesFirst, failChild, includeRedirectHop) => {
          const parent = new MockSession("parent");
          const child = new MockSession("child");
          const manager = new NetworkManager({} as Page);
          const parentCapture = new SessionNetworkCapture(parent);
          const childCapture = new SessionNetworkCapture(child);

          const started: string[] = [];
          const finished: string[] = [];
          const failed: string[] = [];
          const responses: Response[] = [];

          manager.addObserver({
            onRequestStarted: (info) => started.push(info.requestKey),
            onRequestFinished: (info) => finished.push(info.requestKey),
            onRequestFailed: (info) => failed.push(info.requestKey),
            onResponse: (r) => responses.push(r),
          });

          if (includeRedirectHop) {
            parent.emit("Network.requestWillBeSent", {
              requestId: "doc-handoff",
              frameId: "child-frame",
              loaderId: "doc-handoff",
              type: "Document",
              request: { url: "https://example.test/start" },
            });
          }

          parent.emit("Network.requestWillBeSent", {
            requestId: "doc-handoff",
            frameId: "child-frame",
            loaderId: "doc-handoff",
            type: "Document",
            request: { url: "https://example.test/final" },
            ...(includeRedirectHop
              ? {
                  redirectResponse: {
                    url: "https://example.test/start",
                    status: 302,
                    statusText: "Found",
                    headers: {},
                  },
                }
              : {}),
          });
          parent.emit("Network.responseReceived", {
            requestId: "doc-handoff",
            frameId: "child-frame",
            loaderId: "doc-handoff",
            type: "Document",
            response: {
              url: "https://example.test/final",
              status: 200,
              statusText: "OK",
              headers: { "x-final": "yes" },
            },
          });

          child.emit(failChild ? "Network.loadingFailed" : "Network.loadingFinished", {
            requestId: "doc-handoff",
            errorText: "net::ERR_FAILED",
          });

          if (childAttachesFirst) {
            manager.trackSession(child, childCapture, "child-frame");
            manager.trackSession(parent, parentCapture);
          } else {
            manager.trackSession(parent, parentCapture);
            manager.trackSession(child, childCapture, "child-frame");
          }

          expect(responses).toHaveLength(1);
          expect(responses[0]!.session).toBe(child);
          expect(responses[0]!.finishedSettled).toBe(true);
          if (failChild) {
            expect(failed).toEqual(["parent:doc-handoff"]);
            expect(finished).toEqual([]);
            await expect(responses[0]!.finished()).resolves.toBeInstanceOf(Error);
          } else {
            expect(finished).toEqual(["parent:doc-handoff"]);
            expect(failed).toEqual([]);
            await expect(responses[0]!.text()).resolves.toBe("body:child");
          }
          expect(started.length).toBeGreaterThanOrEqual(1);
          expect(manager.requests.size).toBe(0);
          expect(manager.documentRequestsByFrame.size).toBe(0);

          manager.dispose();
          expect(parent.listenerCount()).toBe(0);
          expect(child.listenerCount()).toBe(0);
        },
      ),
      { seed: 0x4e4d0004, numRuns: 40 },
    );
  });

  it("clears unfinishedRequests and respondedRequestKeys on requestServedFromCache without a trailing loadingFinished", () => {
    const session = new MockSession("main");
    const manager = new NetworkManager({} as Page);
    manager.trackSession(session);

    const finished: string[] = [];
    manager.addObserver({
      onRequestFinished: (info) => finished.push(info.requestKey),
    });

    session.emit("Network.requestWillBeSent", {
      requestId: "cached-req",
      frameId: "main-frame",
      loaderId: "loader-1",
      type: "Script",
      request: { url: "https://example.test/app.js" },
    });
    session.emit("Network.responseReceived", {
      requestId: "cached-req",
      frameId: "main-frame",
      loaderId: "loader-1",
      type: "Script",
      response: {
        url: "https://example.test/app.js",
        status: 200,
        statusText: "OK",
        headers: {},
      },
    });
    session.emit("Network.requestServedFromCache", {
      requestId: "cached-req",
    });

    const internals = manager as unknown as {
      respondedRequestKeys: Set<string>;
    };
    expect(finished).toEqual(["main:cached-req"]);
    expect(manager.requests.size).toBe(0);
    expect(manager.sessions.get("main")!.unfinishedRequests.size).toBe(0);
    expect(internals.respondedRequestKeys.size).toBe(0);
    assertManagerInvariants(manager);
    manager.dispose();
  });

  it("preserves cross-session child failure until late parent responseReceived and prunes abandoned entries", async () => {
    const parent = new MockSession("parent");
    const child = new MockSession("child");
    const manager = new NetworkManager({} as Page);
    manager.trackSession(parent);
    manager.trackSession(child, undefined, "child-frame");

    const responses: Response[] = [];
    manager.subscribeResponse((r) => responses.push(r));

    // Parent starts document, child fails before parent receives responseReceived.
    parent.emit("Network.requestWillBeSent", {
      requestId: "doc-1",
      frameId: "child-frame",
      loaderId: "doc-1",
      type: "Document",
      request: { url: "https://example.test/doc-1" },
    });
    child.emit("Network.loadingFailed", {
      requestId: "doc-1",
      errorText: "net::ERR_CONNECTION_RESET",
    });

    // Late parent responseReceived must still settle with the child failure.
    parent.emit("Network.responseReceived", {
      requestId: "doc-1",
      frameId: "child-frame",
      loaderId: "doc-1",
      type: "Document",
      response: {
        url: "https://example.test/doc-1",
        status: 200,
        statusText: "OK",
        headers: {},
      },
    });

    const internals = manager as unknown as {
      pendingDocumentCompletions: Map<string, unknown>;
    };
    expect(responses).toHaveLength(1);
    expect(responses[0]!.finishedSettled).toBe(true);
    await expect(responses[0]!.finished()).resolves.toBeInstanceOf(Error);
    expect(internals.pendingDocumentCompletions.size).toBe(0);

    // Repeated child-fail -> parent-start-without-headers cycles must not leak pendingDocumentCompletions.
    for (let i = 0; i < 40; i += 1) {
      const reqId = `abandoned-${i}`;
      child.emit("Network.loadingFailed", {
        requestId: reqId,
        errorText: "net::ERR_ABORTED",
      });
      parent.emit("Network.requestWillBeSent", {
        requestId: reqId,
        frameId: "child-frame",
        loaderId: reqId,
        type: "Document",
        request: { url: `https://example.test/${reqId}` },
      });
      parent.emit("Page.frameStoppedLoading", {
        frameId: "child-frame",
      });
    }
    expect(internals.pendingDocumentCompletions.size).toBe(0);

    assertManagerInvariants(manager);
    manager.dispose();
  });
});
