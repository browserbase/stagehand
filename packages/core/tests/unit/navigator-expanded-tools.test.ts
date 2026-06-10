import { describe, expect, it } from "vitest";
import {
  NavigatorRefRegistry,
  renderExpandedSnapshot,
  findInSnapshot,
} from "../../lib/v3/agent/utils/navigatorExpandedTools.js";

function snap(
  combinedTree: string,
  combinedXpathMap: Record<string, string> = {},
  combinedUrlMap: Record<string, string> = {},
) {
  return { combinedTree, combinedXpathMap, combinedUrlMap };
}

describe("NavigatorRefRegistry", () => {
  it("mints stable refs and resolves them to encodedId + xpath", () => {
    const r = new NavigatorRefRegistry();
    expect(r.refFor("0-12", "/html/body/button[1]")).toBe("ref_1");
    expect(r.refFor("0-34")).toBe("ref_2");
    // Same element -> same ref (idempotent), and a later xpath refreshes it.
    expect(r.refFor("0-12")).toBe("ref_1");
    expect(r.resolve("ref_1")).toEqual({
      encodedId: "0-12",
      xpath: "/html/body/button[1]",
    });
    expect(r.resolve("ref_2")?.encodedId).toBe("0-34");
    expect(r.resolve("ref_99")).toBeUndefined();
  });

  it("reset clears mappings and the counter", () => {
    const r = new NavigatorRefRegistry();
    r.refFor("0-1");
    r.reset();
    expect(r.resolve("ref_1")).toBeUndefined();
    expect(r.refFor("0-2")).toBe("ref_1");
  });
});

const tree = [
  "[0-1] RootWebArea: Example",
  "  [0-2] button: Sign in [checked]",
  "  [0-3] link: Learn more",
  "    [0-4] generic",
  "  [0-5] textbox: Email",
].join("\n");
const xpaths = {
  "0-2": "/html/body/button[1]",
  "0-5": "/html/body/input[1]",
};

describe("renderExpandedSnapshot", () => {
  it("renders the a11y outline in Navigator extract_elements format with refs", () => {
    const registry = new NavigatorRefRegistry();
    const out = renderExpandedSnapshot(
      snap(tree, xpaths, { "0-3": "https://example.com/learn" }),
      registry,
    );
    expect(out.split("\n")).toEqual([
      '- RootWebArea "Example" [ref=ref_1]',
      '  - button "Sign in" [ref=ref_2]',
      '  - link "Learn more" [ref=ref_3] href="https://example.com/learn"',
      // [0-4] generic with no name is dropped (structural noise)
      '  - textbox "Email" [ref=ref_4]',
    ]);
    // ref carries the xpath for later resolution (set_element_value etc.)
    expect(registry.resolve("ref_2")?.xpath).toBe("/html/body/button[1]");
  });

  it("preserves indentation and strips trailing state flags", () => {
    const registry = new NavigatorRefRegistry();
    expect(
      renderExpandedSnapshot(
        snap("  [0-9] checkbox: Accept [checked]"),
        registry,
      ),
    ).toBe('  - checkbox "Accept" [ref=ref_1]');
  });

  it("is deterministic: same snapshot + registry yields the same refs", () => {
    const registry = new NavigatorRefRegistry();
    const first = renderExpandedSnapshot(snap(tree, xpaths), registry);
    expect(renderExpandedSnapshot(snap(tree, xpaths), registry)).toBe(first);
    expect(registry.resolve("ref_2")?.encodedId).toBe("0-2");
  });

  it("escapes quotes in names and truncates at 100 chars", () => {
    const registry = new NavigatorRefRegistry();
    const out = renderExpandedSnapshot(
      snap(`[0-1] button: Say "hi"\n[0-2] heading: ${"x".repeat(150)}`),
      registry,
    );
    const lines = out.split("\n");
    expect(lines[0]).toBe('- button "Say \\"hi\\"" [ref=ref_1]');
    expect(lines[1]).toBe(`- heading "${"x".repeat(100)}" [ref=ref_2]`);
  });
});

describe("findInSnapshot", () => {
  it("returns matching lines (with refs) for a case-insensitive query", () => {
    const registry = new NavigatorRefRegistry();
    const { matches, total } = findInSnapshot(
      snap(tree, xpaths),
      registry,
      "sign in",
    );
    expect(total).toBe(1);
    // find mints refs only for matches; "Sign in" is the first -> ref_1.
    expect(matches).toEqual(['- button "Sign in" [ref=ref_1]']);
    // ref minted by find resolves to the element's xpath.
    expect(registry.resolve("ref_1")?.xpath).toBe("/html/body/button[1]");
  });

  it("respects the result limit and reports the true total", () => {
    const big = Array.from(
      { length: 30 },
      (_, i) => `[0-${i}] button: Go ${i}`,
    ).join("\n");
    const { matches, total } = findInSnapshot(
      snap(big),
      new NavigatorRefRegistry(),
      "button",
      5,
    );
    expect(total).toBe(30);
    expect(matches).toHaveLength(5);
  });

  it("returns no matches when nothing contains the query", () => {
    const { matches, total } = findInSnapshot(
      snap(tree),
      new NavigatorRefRegistry(),
      "zzz",
    );
    expect(total).toBe(0);
    expect(matches).toEqual([]);
  });
});
