import { afterEach, expect, it, vi } from "vitest";
import { createFrameChainScope } from "../dom/locatorScripts/createFrameChainScope.js";
import { queryAll } from "../dom/locatorScripts/queryAll.js";
import { documentHasShadowRoot } from "../dom/locatorScripts/shadowRoots.js";

vi.mock("../dom/locatorScripts/shadowRoots.js", async (original) => ({
  ...(await original<typeof import("../dom/locatorScripts/shadowRoots.js")>()),
  documentHasShadowRoot: vi.fn(),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

it.each(["queryAll", "frame"])("shares shadow detection within %s batches only", (kind) => {
  class TestDocument {
    documentElement = null;
    evaluate = vi.fn(() => ({ snapshotLength: 0 }));
  }
  const first = new TestDocument();
  const second = new TestDocument();
  vi.stubGlobal("Document", TestDocument);
  vi.stubGlobal("Element", class {});
  vi.stubGlobal("document", first);
  vi.stubGlobal("XPathResult", { ORDERED_NODE_SNAPSHOT_TYPE: 7 });
  const detection = vi.mocked(documentHasShadowRoot).mockReturnValue(false);
  const selector = { kind: "xpath", value: "//button" } as const;
  const frame = createFrameChainScope();
  const query = () =>
    kind === "frame"
      ? frame.query(selector, [0, 0])
      : queryAll(selector, [first, first, second] as unknown as Document[]);
  const scans = kind === "frame" ? 1 : 2;
  query();
  expect(detection).toHaveBeenCalledTimes(scans);
  expect(detection).toHaveBeenCalledWith(first);
  if (kind === "queryAll") expect(detection).toHaveBeenCalledWith(second);
  expect(first.evaluate).toHaveBeenCalledTimes(2);

  detection.mockReturnValue(true);
  query();
  expect(detection).toHaveBeenCalledTimes(2 * scans);
  expect(first.evaluate).toHaveBeenCalledTimes(2);
});
