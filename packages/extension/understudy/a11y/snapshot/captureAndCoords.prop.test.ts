import type { Protocol } from "devtools-protocol";
import fc from "fast-check";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CDPSessionLike } from "../../cdp.js";
import type { Page } from "../../page.js";
import { Progress } from "../../progress.js";
import { executionContexts } from "../../executionContextRegistry.js";
import type { StagehandLogger } from "../../../logger.js";
import { computeActiveElementXpath } from "./activeElement.js";
import { captureHybridSnapshot } from "./capture.js";
import { resolveXpathForLocation } from "./coordinateResolver.js";
import { resolveCssFocusFrameAndTail, resolveFocusFrameAndTail } from "./focusSelectors.js";
import { ownerSession, parentSession } from "./sessions.js";
import { prefixXPath } from "./xpathUtils.js";

const SEED = 0x51a9e101;

function makeFrameTree(
  frameId: string,
  childFrames?: Protocol.Page.FrameTree[],
): Protocol.Page.FrameTree {
  return {
    frame: {
      id: frameId,
      loaderId: `loader-${frameId}`,
      url: `https://example.test/${frameId}`,
      domainAndRegistry: "example.test",
      securityOrigin: "https://example.test",
      mimeType: "text/html",
      secureContextType: "Secure",
      crossOriginIsolatedContextType: "NotIsolated",
      gatedAPIFeatures: [],
    },
    ...(childFrames && childFrames.length ? { childFrames } : {}),
  };
}

describe("focusSelectors properties", () => {
  beforeEach(() => {
    vi.spyOn(executionContexts, "waitForLocatorWorld").mockResolvedValue({
      contextId: 1,
      kind: "extension",
      capabilities: { closedShadowRoots: true },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("resolveCssFocusFrameAndTail never treats >> inside quoted attributes as iframe hops", async () => {
    const attrValArb = fc
      .tuple(fc.stringMatching(/^[a-zA-Z0-9 _-]{0,8}$/), fc.stringMatching(/^[a-zA-Z0-9 _-]{0,8}$/))
      .map(([a, b]) => `${a} >> ${b}`);

    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom("a", "button", "input", "div"),
        fc.constantFrom('"', "'"),
        attrValArb,
        async (tag, quote, val) => {
          const selector = `${tag}[title=${quote}${val}${quote}]`;
          const send = vi.fn(async () => {
            throw new Error("Should not attempt iframe hop for quoted >>");
          });
          const session = { id: "s0", send } as unknown as CDPSessionLike;
          const page = {
            getSessionForFrame: () => session,
          } as unknown as Page;

          const res = await resolveCssFocusFrameAndTail(
            page,
            selector,
            new Map([["root", null]]),
            "root",
          );
          expect(res.targetFrameId).toBe("root");
          expect(res.tailSelector).toBe(selector);
          expect(send).not.toHaveBeenCalled();
        },
      ),
      { seed: SEED, numRuns: 100 },
    );
  });

  it("resolveCssFocusFrameAndTail walks multi-hop iframe chains and releases every objectId", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 4 }),
        fc.stringMatching(/^[a-z]{1,6}$/),
        fc.boolean(),
        async (depth, tailClass, failLastHop) => {
          const frameIds = Array.from({ length: depth + 1 }, (_, i) => `f${i}`);
          const parentByFrame = new Map<string, string | null>();
          for (let i = 0; i < frameIds.length; i++) {
            parentByFrame.set(frameIds[i]!, i === 0 ? null : frameIds[i - 1]!);
          }

          const acquired = new Set<string>();
          const released = new Set<string>();
          const sessions = new Map<string, CDPSessionLike>();

          for (let i = 0; i < frameIds.length; i++) {
            const fid = frameIds[i]!;
            const nextOwnerBe = 100 + i;
            const send = vi.fn(async (method: string, params?: Record<string, unknown>) => {
              if (method === "Runtime.evaluate") {
                const oid = `obj-${fid}`;
                acquired.add(oid);
                return { result: { type: "object", objectId: oid } };
              }
              if (method === "DOM.describeNode") {
                return {
                  node: { backendNodeId: failLastHop && i === depth - 1 ? 9999 : nextOwnerBe },
                };
              }
              if (method === "DOM.getFrameOwner") {
                return { backendNodeId: nextOwnerBe };
              }
              if (method === "Runtime.releaseObject") {
                released.add(String(params?.objectId));
                return {};
              }
              return {};
            });
            sessions.set(fid, { id: `sess-${fid}`, send } as unknown as CDPSessionLike);
          }

          const page = {
            getSessionForFrame: (fid: string) => sessions.get(fid)!,
          } as unknown as Page;

          const hops = Array.from({ length: depth }, (_, i) => `iframe.hop${i}`);
          const selector = [...hops, `.${tailClass}`].join(" >> ");

          if (failLastHop) {
            await expect(
              resolveCssFocusFrameAndTail(page, selector, parentByFrame, "f0"),
            ).rejects.toThrow();
          } else {
            const res = await resolveCssFocusFrameAndTail(page, selector, parentByFrame, "f0");
            expect(res.targetFrameId).toBe(frameIds[depth]);
            expect(res.tailSelector).toBe(`.${tailClass}`);
          }
          expect(released).toEqual(acquired);
        },
      ),
      { seed: SEED + 1, numRuns: 50 },
    );
  });

  it("resolveFocusFrameAndTail handles xpath= prefix, shadow hops, multi-frame paths, and quoted /iframe/ predicates", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom("", "xpath=", "XPATH="),
        fc.constantFrom("'", '"'),
        fc.stringMatching(/^[a-z0-9]{1,8}$/),
        async (prefix, quote, slug) => {
          const raw = `${prefix}//a[@href=${quote}/iframe/${slug}${quote}]`;
          const send = vi.fn(async () => {
            throw new Error("Should not hop into iframe mentioned inside quoted predicate");
          });
          const session = { id: "s0", send } as unknown as CDPSessionLike;
          const page = {
            getSessionForFrame: () => session,
          } as unknown as Page;

          const res = await resolveFocusFrameAndTail(page, raw, new Map([["root", null]]), "root");
          expect(res.targetFrameId).toBe("root");
          expect(res.absPrefix).toBe("");
          expect(res.tailXPath).toBe(`//a[@href=${quote}/iframe/${slug}${quote}]`);
          expect(send).not.toHaveBeenCalled();
        },
      ),
      { seed: SEED + 2, numRuns: 80 },
    );
  });

  it("resolveFocusFrameAndTail resolves nested iframe XPaths with shadow hops and releases objectIds", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 3 }),
        fc.boolean(),
        async (depth, useShadowHop) => {
          const frameIds = Array.from({ length: depth + 1 }, (_, i) => `xf${i}`);
          const parentByFrame = new Map<string, string | null>();
          for (let i = 0; i < frameIds.length; i++) {
            parentByFrame.set(frameIds[i]!, i === 0 ? null : frameIds[i - 1]!);
          }

          const acquired = new Set<string>();
          const released = new Set<string>();
          const sessions = new Map<string, CDPSessionLike>();

          for (let i = 0; i < frameIds.length; i++) {
            const fid = frameIds[i]!;
            const ownerBe = 200 + i;
            const send = vi.fn(async (method: string, params?: Record<string, unknown>) => {
              if (method === "Runtime.evaluate") {
                const oid = `xobj-${fid}`;
                acquired.add(oid);
                return { result: { type: "object", objectId: oid } };
              }
              if (method === "DOM.describeNode") {
                return { node: { backendNodeId: ownerBe } };
              }
              if (method === "DOM.getFrameOwner") {
                return { backendNodeId: ownerBe };
              }
              if (method === "Runtime.releaseObject") {
                released.add(String(params?.objectId));
                return {};
              }
              return {};
            });
            sessions.set(fid, { id: `xsess-${fid}`, send } as unknown as CDPSessionLike);
          }

          const page = {
            getSessionForFrame: (fid: string) => sessions.get(fid)!,
          } as unknown as Page;

          const sep = useShadowHop ? "//" : "/";
          const iframeSteps = Array.from(
            { length: depth },
            (_, i) => `/html[1]/body[1]${sep}iframe[${i + 1}]`,
          ).join("");
          const tail = "/html[1]/body[1]/button[1]";
          const full = `${iframeSteps}${tail}`;

          const res = await resolveFocusFrameAndTail(page, full, parentByFrame, "xf0");
          expect(res.targetFrameId).toBe(frameIds[depth]);
          expect(res.tailXPath).toBe(tail);
          expect(res.absPrefix).toBe(iframeSteps);
          expect(prefixXPath(res.absPrefix, res.tailXPath)).toBe(full);
          expect(released).toEqual(acquired);
        },
      ),
      { seed: SEED + 3, numRuns: 40 },
    );
  });
});

describe("coordinateResolver properties", () => {
  beforeEach(() => {
    vi.spyOn(executionContexts, "waitForMainWorld").mockResolvedValue(1);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const weirdNumberArb = fc.oneof(
    fc.double({ min: -5000, max: 5000, noNaN: false, noDefaultInfinity: false }),
    fc.constantFrom(0, -0, -1, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER),
  );

  it("never passes NaN, Infinity, or negative coordinates to DOM.getNodeForLocation and releases objectIds on faults", async () => {
    await fc.assert(
      fc.asyncProperty(
        weirdNumberArb,
        weirdNumberArb,
        weirdNumberArb,
        weirdNumberArb,
        weirdNumberArb,
        weirdNumberArb,
        fc.boolean(),
        async (x, y, sx, sy, iframeLeft, iframeTop, callFunctionThrows) => {
          const observedCoords: Array<{ x: number; y: number }> = [];
          const acquired = new Set<string>();
          const released = new Set<string>();
          let objectSeq = 0;

          const makeSession = (isParent: boolean): CDPSessionLike =>
            ({
              id: isParent ? "parent" : "child",
              send: vi.fn(async (method: string, params?: Record<string, unknown>) => {
                if (method === "Runtime.evaluate") {
                  return { result: { value: { sx, sy } } };
                }
                if (method === "DOM.getNodeForLocation") {
                  const qx = params?.x as number;
                  const qy = params?.y as number;
                  observedCoords.push({ x: qx, y: qy });
                  return { backendNodeId: isParent ? 10 : 20 };
                }
                if (method === "DOM.getFrameOwner") {
                  return { backendNodeId: 10 };
                }
                if (method === "DOM.resolveNode") {
                  const oid = `coord-obj-${++objectSeq}`;
                  acquired.add(oid);
                  return { object: { objectId: oid } };
                }
                if (method === "Runtime.callFunctionOn") {
                  if (callFunctionThrows) throw new Error("Execution context destroyed");
                  const fn =
                    typeof params?.functionDeclaration === "string"
                      ? params.functionDeclaration
                      : "";
                  if (fn.includes("getBoundingClientRect")) {
                    return { result: { value: { left: iframeLeft, top: iframeTop } } };
                  }
                  return {
                    result: { value: isParent ? "/html[1]/iframe[1]" : "/html[1]/button[1]" },
                  };
                }
                if (method === "Runtime.releaseObject") {
                  released.add(String(params?.objectId));
                  return {};
                }
                return {};
              }),
            }) as unknown as CDPSessionLike;

          const parentSess = makeSession(true);
          const childSess = makeSession(false);
          const tree = makeFrameTree("main", [makeFrameTree("child")]);
          const page = {
            getFullFrameTree: () => tree,
            mainFrameId: () => "main",
            getSessionForFrame: (fid: string) => (fid === "main" ? parentSess : childSess),
          } as unknown as Page;

          const result = await resolveXpathForLocation(page, x, y);

          if (!Number.isFinite(x) || !Number.isFinite(y)) {
            expect(result).toBeNull();
            expect(observedCoords).toHaveLength(0);
          }

          for (const c of observedCoords) {
            expect(Number.isFinite(c.x)).toBe(true);
            expect(Number.isFinite(c.y)).toBe(true);
            expect(Number.isInteger(c.x)).toBe(true);
            expect(Number.isInteger(c.y)).toBe(true);
            expect(c.x).toBeGreaterThanOrEqual(0);
            expect(c.y).toBeGreaterThanOrEqual(0);
          }

          expect(released).toEqual(acquired);
        },
      ),
      { seed: SEED + 10, numRuns: 120 },
    );
  });

  it("composes iframe offsets monotonically across nested frames", async () => {
    const finiteCoordArb = fc.double({ min: 0, max: 2000, noNaN: true, noDefaultInfinity: true });

    await fc.assert(
      fc.asyncProperty(
        finiteCoordArb,
        finiteCoordArb,
        finiteCoordArb,
        finiteCoordArb,
        fc.array(
          fc.record({
            left: fc.double({ min: 0, max: 400, noNaN: true, noDefaultInfinity: true }),
            top: fc.double({ min: 0, max: 400, noNaN: true, noDefaultInfinity: true }),
            sx: fc.double({ min: 0, max: 200, noNaN: true, noDefaultInfinity: true }),
            sy: fc.double({ min: 0, max: 200, noNaN: true, noDefaultInfinity: true }),
          }),
          { minLength: 1, maxLength: 4 },
        ),
        async (x1, dx, y1, dy, framesSpec) => {
          const x2 = x1 + dx;
          const y2 = y1 + dy;

          const runAt = async (px: number, py: number) => {
            const queriedByDepth: Array<{ x: number; y: number }> = [];
            const depthCount = framesSpec.length;
            const frameIds = Array.from({ length: depthCount + 1 }, (_, i) => `cf${i}`);
            let tree = makeFrameTree(frameIds[depthCount]!);
            for (let i = depthCount - 1; i >= 0; i--) {
              tree = makeFrameTree(frameIds[i]!, [tree]);
            }

            const sessions = new Map<string, CDPSessionLike>();
            for (let i = 0; i <= depthCount; i++) {
              const fid = frameIds[i]!;
              const isLeaf = i === depthCount;
              const spec = framesSpec[Math.min(i, depthCount - 1)]!;
              const ownerBe = 100 + i;
              sessions.set(fid, {
                id: `cs-${i}`,
                send: vi.fn(async (method: string, params?: Record<string, unknown>) => {
                  if (method === "Runtime.evaluate") {
                    return { result: { value: { sx: spec.sx, sy: spec.sy } } };
                  }
                  if (method === "DOM.getNodeForLocation") {
                    queriedByDepth.push({ x: params?.x as number, y: params?.y as number });
                    return { backendNodeId: isLeaf ? 999 : ownerBe };
                  }
                  if (method === "DOM.getFrameOwner") {
                    return { backendNodeId: ownerBe };
                  }
                  if (method === "DOM.resolveNode") {
                    return { object: { objectId: `oid-${i}` } };
                  }
                  if (method === "Runtime.callFunctionOn") {
                    const fn =
                      typeof params?.functionDeclaration === "string"
                        ? params.functionDeclaration
                        : "";
                    if (fn.includes("getBoundingClientRect")) {
                      return { result: { value: { left: spec.left, top: spec.top } } };
                    }
                    return {
                      result: {
                        value: isLeaf ? "/html[1]/button[1]" : `/html[1]/iframe[${i + 1}]`,
                      },
                    };
                  }
                  return {};
                }),
              } as unknown as CDPSessionLike);
            }

            const page = {
              getFullFrameTree: () => tree,
              mainFrameId: () => frameIds[0]!,
              getSessionForFrame: (fid: string) => sessions.get(fid)!,
            } as unknown as Page;

            const loc = await resolveXpathForLocation(page, px, py);
            return { loc, queriedByDepth };
          };

          const r1 = await runAt(x1, y1);
          const r2 = await runAt(x2, y2);
          expect(r1.loc).not.toBeNull();
          expect(r2.loc).not.toBeNull();
          expect(r1.queriedByDepth.length).toBe(r2.queriedByDepth.length);
          for (let d = 0; d < r1.queriedByDepth.length; d++) {
            expect(r2.queriedByDepth[d]!.x).toBeGreaterThanOrEqual(r1.queriedByDepth[d]!.x);
            expect(r2.queriedByDepth[d]!.y).toBeGreaterThanOrEqual(r1.queriedByDepth[d]!.y);
          }
        },
      ),
      { seed: SEED + 11, numRuns: 60 },
    );
  });

  it("handles detached main frame and cyclic frame trees without throwing", async () => {
    const cyclic = makeFrameTree("root");
    cyclic.childFrames = [cyclic];
    const brokenPage = {
      getFullFrameTree: () => cyclic,
      mainFrameId: () => "root",
      getSessionForFrame: () => {
        throw new Error("Target closed");
      },
    } as unknown as Page;

    await expect(resolveXpathForLocation(brokenPage, 10, 20)).resolves.toBeNull();
  });
});

describe("captureHybridSnapshot, sessions & activeElement multi-frame properties", () => {
  type ChildFault = "none" | "emptyAx" | "axThrow" | "domThrow" | "ownerThrow" | "missingSession";

  type FrameTopologySpec = {
    children: Array<{
      id: string;
      oopif: boolean;
      fault: ChildFault;
      malformedName: boolean;
      nested?: {
        id: string;
        oopif: boolean;
        fault: ChildFault;
      };
    }>;
  };

  const faultArb = fc.constantFrom<ChildFault>(
    "none",
    "emptyAx",
    "axThrow",
    "domThrow",
    "ownerThrow",
    "missingSession",
  );

  const topologyArb: fc.Arbitrary<FrameTopologySpec> = fc.record({
    children: fc.array(
      fc.record({
        id: fc.integer({ min: 1, max: 99 }).map((n) => `child-${n}`),
        oopif: fc.boolean(),
        fault: faultArb,
        malformedName: fc.boolean(),
        nested: fc.option(
          fc.record({
            id: fc.integer({ min: 100, max: 199 }).map((n) => `nested-${n}`),
            oopif: fc.boolean(),
            fault: faultArb,
          }),
          { nil: undefined },
        ),
      }),
      { minLength: 0, maxLength: 3 },
    ),
  });

  function buildUniqueTopology(raw: FrameTopologySpec): FrameTopologySpec {
    const seen = new Set<string>(["root"]);
    const children: FrameTopologySpec["children"] = [];
    for (let i = 0; i < raw.children.length; i++) {
      const c = raw.children[i]!;
      const cid = seen.has(c.id) ? `child-u${i}` : c.id;
      seen.add(cid);
      let nested = c.nested;
      if (nested) {
        const nid = seen.has(nested.id) ? `nested-u${i}` : nested.id;
        seen.add(nid);
        nested = { ...nested, id: nid };
      }
      children.push({ ...c, id: cid, nested });
    }
    return { children };
  }

  it("captureHybridSnapshot survives child frame/OOPIF faults with consistent maps and deterministic ordinals", async () => {
    await fc.assert(
      fc.asyncProperty(topologyArb, fc.boolean(), async (rawTopo, reverseFrameOrder) => {
        const topo = buildUniqueTopology(rawTopo);

        const runCapture = async () => {
          const allFrameIds = ["root"];
          const parentByFrame = new Map<string, string | null>([["root", null]]);
          const childTrees: Protocol.Page.FrameTree[] = [];
          const faultByFrame = new Map<string, ChildFault>([["root", "none"]]);
          const oopifByFrame = new Map<string, boolean>([["root", false]]);
          const ownerBeByFrame = new Map<string, number>();

          let nextBe = 10;
          const makeSimpleDoc = (
            iframeNodes: Protocol.DOM.Node[],
            buttonBe: number,
          ): Protocol.DOM.Node => {
            const docBe = nextBe++;
            const htmlBe = nextBe++;
            const bodyBe = nextBe++;
            return {
              nodeId: docBe,
              backendNodeId: docBe,
              nodeType: 9,
              nodeName: "#document",
              localName: "",
              nodeValue: "",
              childNodeCount: 1,
              children: [
                {
                  nodeId: htmlBe,
                  backendNodeId: htmlBe,
                  nodeType: 1,
                  nodeName: "HTML",
                  localName: "html",
                  nodeValue: "",
                  childNodeCount: 1,
                  children: [
                    {
                      nodeId: bodyBe,
                      backendNodeId: bodyBe,
                      nodeType: 1,
                      nodeName: "BODY",
                      localName: "body",
                      nodeValue: "",
                      childNodeCount: 1 + iframeNodes.length,
                      children: [
                        {
                          nodeId: buttonBe,
                          backendNodeId: buttonBe,
                          nodeType: 1,
                          nodeName: "BUTTON",
                          localName: "button",
                          nodeValue: "",
                          childNodeCount: 0,
                          children: [],
                        },
                        ...iframeNodes,
                      ],
                    },
                  ],
                },
              ],
            };
          };

          const rootIframeNodes: Protocol.DOM.Node[] = [];
          const oopifDocs = new Map<string, Protocol.DOM.Node>();
          const buttonBeByFrame = new Map<string, number>();
          const malformedByFrame = new Map<string, boolean>();
          const rootButtonBe = nextBe++;
          buttonBeByFrame.set("root", rootButtonBe);

          for (const child of topo.children) {
            allFrameIds.push(child.id);
            parentByFrame.set(child.id, "root");
            faultByFrame.set(child.id, child.fault);
            oopifByFrame.set(child.id, child.oopif);
            malformedByFrame.set(child.id, child.malformedName);

            const childHostBe = nextBe++;
            ownerBeByFrame.set(child.id, childHostBe);
            const childButtonBe = nextBe++;
            buttonBeByFrame.set(child.id, childButtonBe);

            const nestedIframeNodes: Protocol.DOM.Node[] = [];
            const nestedFrameTrees: Protocol.Page.FrameTree[] = [];

            if (child.nested) {
              allFrameIds.push(child.nested.id);
              parentByFrame.set(child.nested.id, child.id);
              faultByFrame.set(child.nested.id, child.nested.fault);
              oopifByFrame.set(child.nested.id, child.nested.oopif);

              const nestedHostBe = nextBe++;
              ownerBeByFrame.set(child.nested.id, nestedHostBe);
              const nestedButtonBe = nextBe++;
              buttonBeByFrame.set(child.nested.id, nestedButtonBe);

              const nestedDoc = makeSimpleDoc([], nestedButtonBe);
              const nestedIframeEl: Protocol.DOM.Node = {
                nodeId: nestedHostBe,
                backendNodeId: nestedHostBe,
                nodeType: 1,
                nodeName: "IFRAME",
                localName: "iframe",
                nodeValue: "",
                childNodeCount: 0,
                children: [],
                ...(child.nested.oopif ? {} : { contentDocument: nestedDoc }),
              };
              nestedIframeNodes.push(nestedIframeEl);
              if (child.nested.oopif) {
                oopifDocs.set(child.nested.id, nestedDoc);
              }
              nestedFrameTrees.push(makeFrameTree(child.nested.id));
            }

            const childDoc = makeSimpleDoc(nestedIframeNodes, childButtonBe);
            const childIframeEl: Protocol.DOM.Node = {
              nodeId: childHostBe,
              backendNodeId: childHostBe,
              nodeType: 1,
              nodeName: "IFRAME",
              localName: "iframe",
              nodeValue: "",
              childNodeCount: 0,
              children: [],
              ...(child.oopif ? {} : { contentDocument: childDoc }),
            };
            rootIframeNodes.push(childIframeEl);
            if (child.oopif) {
              oopifDocs.set(child.id, childDoc);
            }
            childTrees.push(makeFrameTree(child.id, nestedFrameTrees));
          }

          const rootDoc = makeSimpleDoc(rootIframeNodes, rootButtonBe);
          const fullTree = makeFrameTree("root", childTrees);

          const makeAxForFrame = (fid: string): Protocol.Accessibility.AXNode[] => {
            if (faultByFrame.get(fid) === "emptyAx") return [];
            const btnBe = buttonBeByFrame.get(fid)!;
            const suffix = malformedByFrame.get(fid) ? String.fromCharCode(0xd83c) : "";
            const childIframes = [...parentByFrame.entries()]
              .filter(([, parent]) => parent === fid)
              .map(([childId]) => childId);
            const rootChildIds = ["btn", ...childIframes.map((cid) => `if-${cid}`)];
            const nodes: Protocol.Accessibility.AXNode[] = [
              {
                nodeId: "ax-root",
                ignored: false,
                role: { type: "role", value: "RootWebArea" },
                name: { type: "computedString", value: `Frame ${fid}` },
                childIds: rootChildIds,
              },
              {
                nodeId: "btn",
                parentId: "ax-root",
                ignored: false,
                backendDOMNodeId: btnBe,
                role: { type: "role", value: "button" },
                name: { type: "computedString", value: `Click ${fid} ${suffix}` },
              },
            ];
            for (const cid of childIframes) {
              nodes.push({
                nodeId: `if-${cid}`,
                parentId: "ax-root",
                ignored: false,
                backendDOMNodeId: ownerBeByFrame.get(cid),
                role: { type: "role", value: "Iframe" },
                name: { type: "computedString", value: `Host ${cid}` },
              });
            }
            return nodes;
          };

          const makeSessionForOwner = (
            ownerFrameId: string,
            doc: Protocol.DOM.Node,
          ): CDPSessionLike =>
            ({
              id: `sess-${ownerFrameId}`,
              send: vi.fn(async (method: string, params?: Record<string, unknown>) => {
                if (method === "DOM.getDocument") {
                  if (ownerFrameId !== "root" && faultByFrame.get(ownerFrameId) === "domThrow") {
                    throw new Error("Target closed");
                  }
                  return { root: doc };
                }
                if (method === "DOM.getFrameOwner") {
                  const targetFid = typeof params?.frameId === "string" ? params.frameId : "";
                  if (faultByFrame.get(targetFid) === "ownerThrow") {
                    throw new Error("Frame detached");
                  }
                  return { backendNodeId: ownerBeByFrame.get(targetFid) };
                }
                if (method === "Accessibility.getFullAXTree") {
                  const targetFid =
                    typeof params?.frameId === "string" ? params.frameId : ownerFrameId;
                  if (targetFid !== "root" && faultByFrame.get(targetFid) === "axThrow") {
                    throw new Error("Session closed");
                  }
                  return { nodes: makeAxForFrame(targetFid) };
                }
                return {};
              }),
            }) as unknown as CDPSessionLike;

          const sessionsByOwner = new Map<string, CDPSessionLike>();
          sessionsByOwner.set("root", makeSessionForOwner("root", rootDoc));
          for (const [fid, doc] of oopifDocs.entries()) {
            sessionsByOwner.set(fid, makeSessionForOwner(fid, doc));
          }

          const sessionOwnerOf = (fid: string): string => {
            let cur: string | null = fid;
            while (cur) {
              if (sessionsByOwner.has(cur)) return cur;
              cur = parentByFrame.get(cur) ?? null;
            }
            return "root";
          };

          const ordinals = new Map<string, number>();
          let nextOrd = 0;
          const getOrdinal = (fid: string): number => {
            const hit = ordinals.get(fid);
            if (hit !== undefined) return hit;
            const assigned = nextOrd++;
            ordinals.set(fid, assigned);
            return assigned;
          };

          const page = {
            logger: {
              warn: vi.fn(),
              info: vi.fn(),
              debug: vi.fn(),
              error: vi.fn(),
            } as unknown as StagehandLogger,
            mainFrameId: () => "root",
            asProtocolFrameTree: () => fullTree,
            listAllFrameIds: () => (reverseFrameOrder ? [...allFrameIds].reverse() : allFrameIds),
            getOrdinal,
            getSessionForFrame: (fid: string) => {
              if (fid !== "root" && faultByFrame.get(fid) === "missingSession") {
                throw new Error(`No session for detached frame ${fid}`);
              }
              return sessionsByOwner.get(sessionOwnerOf(fid))!;
            },
          } as unknown as Page;

          for (const fid of allFrameIds) {
            if (fid === "root" || faultByFrame.get(fid) !== "missingSession") {
              expect(ownerSession(page, fid)).toBe(sessionsByOwner.get(sessionOwnerOf(fid)));
              const parentId = parentByFrame.get(fid) ?? null;
              if (!parentId || faultByFrame.get(parentId) !== "missingSession") {
                const expectedParentSess = parentId
                  ? sessionsByOwner.get(sessionOwnerOf(parentId))
                  : sessionsByOwner.get("root");
                expect(parentSession(page, parentByFrame, fid)).toBe(expectedParentSess);
              }
            }
          }

          const progress = new Progress("snapshot-prop", 0);
          try {
            const snapshot = await captureHybridSnapshot(page, { includeIframes: true }, progress);
            return { snapshot, ordinals: [...ordinals.entries()] };
          } finally {
            progress.dispose();
          }
        };

        const runA = await runCapture();
        const runB = await runCapture();

        expect(runA.ordinals).toEqual(runB.ordinals);
        expect(runA.snapshot.combinedXpathMap).toEqual(runB.snapshot.combinedXpathMap);
        expect(runA.snapshot.combinedTree).toBe(runB.snapshot.combinedTree);

        expect(
          (runA.snapshot.combinedTree as string & { isWellFormed(): boolean }).isWellFormed(),
        ).toBe(true);
        for (const pf of runA.snapshot.perFrame ?? []) {
          expect((pf.outline as string & { isWellFormed(): boolean }).isWellFormed()).toBe(true);
          for (const key of Object.keys(pf.xpathMap)) {
            expect(runA.snapshot.combinedXpathMap[key]).toBeDefined();
          }
        }

        for (const [encId, xp] of Object.entries(runA.snapshot.combinedXpathMap)) {
          expect(encId).toMatch(/^\d+-\d+$/);
          expect(xp.startsWith("/")).toBe(true);
          expect(xp.includes("///")).toBe(false);
        }

        const rootBtnEntries = Object.keys(runA.snapshot.combinedXpathMap).filter((k) =>
          k.startsWith(`${runA.ordinals.find(([fid]) => fid === "root")?.[1]}-`),
        );
        expect(rootBtnEntries.length).toBeGreaterThan(0);
      }),
      { seed: SEED + 20, numRuns: 50 },
    );
  });

  it("computeActiveElementXpath composes nested iframe prefixes in outer-to-inner order", async () => {
    vi.spyOn(executionContexts, "waitForMainWorld").mockResolvedValue(1);
    vi.spyOn(executionContexts, "waitForLocatorWorld").mockResolvedValue({
      contextId: 2,
      kind: "extension",
      capabilities: { closedShadowRoots: true },
    });

    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 4 }), async (depth) => {
        const frameIds = Array.from({ length: depth + 1 }, (_, i) => `af${i}`);
        let tree = makeFrameTree(frameIds[depth]!);
        for (let i = depth - 1; i >= 0; i--) {
          tree = makeFrameTree(frameIds[i]!, [tree]);
        }

        const sessions = new Map<string, CDPSessionLike>();
        for (let i = 0; i <= depth; i++) {
          const fid = frameIds[i]!;
          const isLeaf = i === depth;
          const ownerBe = 300 + i;
          sessions.set(fid, {
            id: `as-${i}`,
            send: vi.fn(async (method: string, params?: Record<string, unknown>) => {
              if (method === "Runtime.evaluate") {
                if (params?.returnByValue === true) {
                  return { result: { value: isLeaf } };
                }
                return { result: { objectId: `active-${i}` } };
              }
              if (method === "DOM.getFrameOwner") {
                return { backendNodeId: ownerBe };
              }
              if (method === "DOM.resolveNode") {
                return { object: { objectId: `owner-obj-${i}` } };
              }
              if (method === "Runtime.callFunctionOn") {
                return {
                  result: {
                    value: isLeaf
                      ? "/html[1]/body[1]/input[1]"
                      : `/html[1]/body[1]/iframe[${i + 1}]`,
                  },
                };
              }
              return {};
            }),
          } as unknown as CDPSessionLike);
        }

        const page = {
          getFullFrameTree: () => tree,
          listAllFrameIds: () => frameIds,
          mainFrameId: () => frameIds[0]!,
          getSessionForFrame: (fid: string) => sessions.get(fid)!,
        } as unknown as Page;

        const activeXp = await computeActiveElementXpath(page);
        const expectedPrefix = Array.from(
          { length: depth },
          (_, i) => `/html[1]/body[1]/iframe[${i + 1}]`,
        ).join("");
        expect(activeXp).toBe(`${expectedPrefix}/html[1]/body[1]/input[1]`);
      }),
      { seed: SEED + 21, numRuns: 20 },
    );

    const cyclic = makeFrameTree("root");
    cyclic.childFrames = [cyclic];
    const cyclicPage = {
      getFullFrameTree: () => cyclic,
      listAllFrameIds: () => ["root"],
      mainFrameId: () => "root",
      getSessionForFrame: () =>
        ({
          id: "cyclic",
          send: vi.fn(async () => ({ result: {} })),
        }) as unknown as CDPSessionLike,
    } as unknown as Page;
    await expect(computeActiveElementXpath(cyclicPage)).resolves.toBeNull();

    vi.restoreAllMocks();
  });
});
