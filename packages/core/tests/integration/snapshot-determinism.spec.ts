import { test, expect } from "@playwright/test";
import { V3 } from "../../lib/v3/v3.js";
import { captureHybridSnapshot } from "../../lib/v3/understudy/a11y/snapshot/index.js";
import { v3TestConfig } from "./v3.config.js";

/**
 * Checks whether captureHybridSnapshot produces identical combinedTree strings
 * across two entirely separate browser sessions navigated to the same static page.
 *
 * This mirrors real-world cache usage: two independent requests hit the same URL,
 * each with their own browser session. A determinism failure here means the cache
 * hash would differ between those sessions, causing a cache miss even though the
 * page content is identical.
 */
test.describe("captureHybridSnapshot determinism", () => {
  let v3a: V3;
  let v3b: V3;

  test.beforeEach(async () => {
    v3a = new V3(v3TestConfig);
    v3b = new V3(v3TestConfig);
    await Promise.all([v3a.init(), v3b.init()]);
  });

  test.afterEach(async () => {
    await Promise.all([
      v3a?.close?.().catch(() => {}),
      v3b?.close?.().catch(() => {}),
    ]);
  });

  test("two separate sessions on the same static page produce identical trees", async () => {
    const pageA = v3a.context.pages()[0];
    const pageB = v3b.context.pages()[0];
    await Promise.all([
      pageA.goto("https://example.com"),
      pageB.goto("https://example.com"),
    ]);

    const [snap1, snap2] = await Promise.all([
      captureHybridSnapshot(pageA),
      captureHybridSnapshot(pageB),
    ]);

    if (snap1.combinedTree !== snap2.combinedTree) {
      const lines1 = snap1.combinedTree.split("\n");
      const lines2 = snap2.combinedTree.split("\n");
      const maxLines = Math.max(lines1.length, lines2.length);
      const diffLines: string[] = [];
      for (let i = 0; i < maxLines; i++) {
        const l1 = lines1[i] ?? "<missing>";
        const l2 = lines2[i] ?? "<missing>";
        if (l1 !== l2) {
          diffLines.push(`line ${i + 1}:`);
          diffLines.push(`  sessionA: ${l1}`);
          diffLines.push(`  sessionB: ${l2}`);
        }
      }
      console.log("=== DIFF ===\n" + diffLines.join("\n"));
    }

    expect(snap1.combinedTree).toBe(snap2.combinedTree);
  });

  test("two separate sessions with pierceShadow produce identical trees", async () => {
    const pageA = v3a.context.pages()[0];
    const pageB = v3b.context.pages()[0];
    await Promise.all([
      pageA.goto("https://example.com"),
      pageB.goto("https://example.com"),
    ]);

    const [snap1, snap2] = await Promise.all([
      captureHybridSnapshot(pageA, { pierceShadow: true }),
      captureHybridSnapshot(pageB, { pierceShadow: true }),
    ]);

    expect(snap1.combinedTree).toBe(snap2.combinedTree);
  });

  test("hashMode: true returns a string with no encoded IDs that is deterministic across sessions", async () => {
    const pageA = v3a.context.pages()[0];
    const pageB = v3b.context.pages()[0];
    await Promise.all([
      pageA.goto("https://example.com"),
      pageB.goto("https://example.com"),
    ]);

    const [treeA, treeB] = await Promise.all([
      captureHybridSnapshot(pageA, { hashMode: true }),
      captureHybridSnapshot(pageB, { hashMode: true }),
    ]);

    // Must return a plain string, not a HybridSnapshot object
    expect(typeof treeA).toBe("string");
    expect(typeof treeB).toBe("string");

    // No [encodedId] prefixes — backendNodeIds are session-specific and must
    // be stripped before hashing so two sessions on the same page hash identically
    expect(treeA).not.toMatch(/^\s*\[\d+-\d+\]/m);
    expect(treeB).not.toMatch(/^\s*\[\d+-\d+\]/m);

    // Identical content across independent sessions
    expect(treeA).toBe(treeB);
  });

  test("two separate sessions without iframes produce identical trees", async () => {
    const pageA = v3a.context.pages()[0];
    const pageB = v3b.context.pages()[0];
    await Promise.all([
      pageA.goto("https://example.com"),
      pageB.goto("https://example.com"),
    ]);

    const [snap1, snap2] = await Promise.all([
      captureHybridSnapshot(pageA, { includeIframes: false }),
      captureHybridSnapshot(pageB, { includeIframes: false }),
    ]);

    expect(snap1.combinedTree).toBe(snap2.combinedTree);
  });
});
