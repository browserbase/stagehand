import { afterEach, describe, expect, it, vi } from "vitest";
import type { Protocol } from "devtools-protocol";
import type { Page } from "../../page.js";
import { Progress } from "../../progress.js";
import { executionContexts } from "../../executionContextRegistry.js";
import { encodeLocatorQuery } from "../../../types/private/semanticLocator.js";
import { captureHybridSnapshot } from "./capture.js";

const hostXPath = "/html[1]/body[1]/iframe[1]";
const leafXPath = "/html[1]/body[1]/section[1]/button[1]";

function frameFixture(depth: number, sameSession: boolean) {
  const node = (
    id: number,
    name: string,
    children: Protocol.DOM.Node[] = [],
  ): Protocol.DOM.Node => ({
    nodeId: id,
    backendNodeId: id,
    nodeName: name,
    localName: name.toLowerCase(),
    nodeType: name === "#document" ? 9 : 1,
    nodeValue: "",
    children,
  });
  const documents: Protocol.DOM.Node[] = [];
  for (let level = depth; level >= 0; level -= 1) {
    const base = level * 100;
    const contents =
      level === depth
        ? node(base + 3, "SECTION", [node(base + 4, "BUTTON")])
        : node(base + 3, "IFRAME");
    if (sameSession && level < depth) contents.contentDocument = documents[level + 1];
    documents[level] = node(base, "#document", [
      node(base + 1, "HTML", [node(base + 2, "BODY", [contents])]),
    ]);
  }
  const sessions = documents.map((document, level) => {
    const send = vi.fn(
      async (method: string, params?: Record<string, unknown>): Promise<unknown> => {
        if (method === "Runtime.evaluate") {
          const frame = Number(params?.contextId) - 1;
          const target =
            frame * 100 +
            (frame < depth || !String(params?.expression).includes("resolveSemanticSelector")
              ? 3
              : 4);
          return { result: { objectId: `node-${target}` } };
        }
        if (method === "DOM.requestNode")
          return { nodeId: Number(String(params?.objectId).slice(5)) };
        if (method === "DOM.describeNode")
          return { node: { backendNodeId: Number(String(params?.objectId).slice(5)) } };
        if (method === "DOM.getFrameOwner")
          return { backendNodeId: (Number(params?.frameId) - 1) * 100 + 3 };
        if (method === "Runtime.callFunctionOn") return { result: { value: hostXPath } };
        if (method === "DOM.getDocument") {
          // CDP's pierce flag controls iframe documents as well as shadow roots.
          const root = structuredClone(document);
          if (!params?.pierce) {
            const stack = [root];
            while (stack.length) {
              const current = stack.pop()!;
              delete current.contentDocument;
              delete current.shadowRoots;
              stack.push(...(current.children ?? []));
            }
          }
          return { root };
        }
        if (method === "Accessibility.getFullAXTree") {
          const frame = Number(params?.frameId);
          const base = frame * 100;
          return {
            nodes:
              frame === depth
                ? [
                    {
                      nodeId: "section",
                      backendDOMNodeId: base + 3,
                      role: { value: "group" },
                      childIds: ["button"],
                    },
                    {
                      nodeId: "button",
                      parentId: "section",
                      backendDOMNodeId: base + 4,
                      role: { value: "button" },
                      name: { value: "Save" },
                      childIds: [],
                    },
                  ]
                : [
                    {
                      nodeId: `iframe-${frame}`,
                      backendDOMNodeId: base + 3,
                      role: { value: "iframe" },
                      childIds: [],
                    },
                  ],
          };
        }
        return {};
      },
    );
    return { id: `session-${level}`, send };
  });
  let tree = { frame: { id: String(depth) } } as Protocol.Page.FrameTree;
  for (let level = depth - 1; level >= 0; level -= 1) {
    tree = { frame: { id: String(level) } as Protocol.Page.Frame, childFrames: [tree] };
  }
  const warn = vi.fn();
  const page = {
    logger: { warn },
    mainFrameId: () => "0",
    listAllFrameIds: () => documents.map((_, level) => String(level)),
    asProtocolFrameTree: () => tree,
    getSessionForFrame: (id: string) => sessions[sameSession ? 0 : Number(id)],
    getOrdinal: Number,
  } as unknown as Page;
  vi.spyOn(executionContexts, "waitForLocatorWorld").mockImplementation(
    async (_session, frameId) => ({
      contextId: Number(frameId) + 1,
      kind: "extension",
      capabilities: { closedShadowRoots: true },
    }),
  );
  return { page, sessions, warn };
}

afterEach(() => vi.restoreAllMocks());

describe("scoped snapshot iframe prefixes", () => {
  it.each(
    [true, false].flatMap((sameSession) =>
      [1, 2].flatMap((depth) =>
        [true, false].flatMap((semantic) =>
          [true, false].map((pierceShadow) => ({ sameSession, depth, semantic, pierceShadow })),
        ),
      ),
    ),
  )(
    "keeps global XPaths for $depth hops (sameSession: $sameSession, semantic: $semantic, pierceShadow: $pierceShadow)",
    async ({ sameSession, depth, semantic, pierceShadow }) => {
      const { page, warn } = frameFixture(depth, sameSession);
      const rootSelector = [...Array.from({ length: depth }, () => "iframe"), "section"].join(
        " >> ",
      );
      const selector = semantic
        ? encodeLocatorQuery([
            { kind: "selector", selector: rootSelector },
            { kind: "role", role: "button" },
          ])
        : rootSelector;
      const progress = new Progress("snapshot", 1000);
      try {
        const result = await captureHybridSnapshot(
          page,
          { focusLocator: { selector }, pierceShadow },
          progress,
        );
        expect(result.perFrame?.map(({ frameId }) => frameId)).toEqual([String(depth)]);
        expect(result.combinedXpathMap[`${depth}-${depth * 100 + 4}`]).toBe(
          hostXPath.repeat(depth) + leafXPath,
        );
        expect(warn).not.toHaveBeenCalled();
      } finally {
        progress.dispose();
      }
    },
  );

  it.each([undefined, "", "/", "relative/path"])(
    "falls back to global maps when an iframe XPath is %s",
    async (value) => {
      const { page, sessions, warn } = frameFixture(1, false);
      const send = sessions[0].send.getMockImplementation()!;
      sessions[0].send.mockImplementation(async (method, params) =>
        method === "Runtime.callFunctionOn" ? { result: { value } } : send(method, params),
      );
      const progress = new Progress("snapshot", 1000);
      try {
        const result = await captureHybridSnapshot(
          page,
          {
            focusLocator: { selector: "iframe >> section" },
          },
          progress,
        );
        expect(result.perFrame?.map(({ frameId }) => frameId)).toEqual(["0", "1"]);
        expect(result.combinedXpathMap["1-104"]).toBe(hostXPath + leafXPath);
        expect(warn).toHaveBeenCalledOnce();
        expect(sessions[0].send).toHaveBeenCalledWith("Runtime.releaseObject", {
          objectId: "node-3",
        });
      } finally {
        progress.dispose();
      }
    },
  );
});
