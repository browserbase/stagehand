import { describe, expect, it, vi } from "vitest";
import {
  requestedDestination,
  extractLinkDestination,
} from "../services/decisions/linkDestination.js";
import type { HybridSnapshot } from "../types/private/snapshot.js";

const schema = { type: "object", properties: { value: { type: "string" } }, required: ["value"] };
const optional = { ...schema, required: [] };
const instruction = 'Copy the URL of the link named "Guide".';
const guide = {
  xpath: "/html[1]/body[1]/a[1]",
  name: "Guide",
  raw: "../guide?q=1#start",
  href: "https://example.com/guide?q=1#start",
};

function snapshot(anchors: (typeof guide)[]): HybridSnapshot {
  const outline = anchors.map((link, i) => `[0-${i}] link: ${link.name}`).join("\n");
  const urlMap = Object.fromEntries(anchors.map((link, i) => [`0-${i}`, link.href]));
  const xpathMap = Object.fromEntries(anchors.map((link, i) => [`0-${i}`, link.xpath]));
  return {
    combinedTree: outline,
    combinedUrlMap: urlMap,
    combinedXpathMap: xpathMap,
    perFrame: [{ frameId: "main", outline, xpathMap, urlMap }],
  };
}

describe("link destination extraction", () => {
  it("requires an explicit destination instruction and a single compatible field", () => {
    for (const prompt of [
      "Copy the visible text of the Guide link.",
      "Return the address printed in the Guide.",
      'Give the address of "Guide".',
      "Copy the URL of the Guide link, but return its label instead.",
      "Copy the URL of the Guide link. Return the result in other.",
    ])
      expect(
        requestedDestination(prompt, { ...schema, properties: { url: { type: "string" } } }),
      ).toBeUndefined();

    for (const properties of [
      { value: { type: "array" } },
      { value: { type: "string", description: "Copy only the hostname" } },
      { value: { type: "string", pattern: "^book:" } },
      { value: { type: "string" }, other: { type: "number" } },
    ])
      expect(
        requestedDestination(instruction, { ...schema, properties } as typeof schema),
      ).toBeUndefined();
  });

  it("preserves raw spelling and returns the browser-resolved absolute address", async () => {
    const anchors = [guide, { ...guide, xpath: "/html[1]/body[1]/a[2]" }];
    for (const [form, value] of [
      ["URL", guide.href],
      ["absolute href", guide.href],
      ["relative URL", guide.raw],
      ["raw href", guide.raw],
    ]) {
      const request = requestedDestination(instruction.replace("URL", form!), schema)!;
      expect(await extractLinkDestination(request, snapshot(anchors), async () => anchors)).toEqual(
        { data: { value } },
      );
    }
    const differentRaw = [guide, { ...guide, raw: "/guide?q=1#start" }];
    const raw = requestedDestination(instruction.replace("URL", "relative href"), schema)!;
    expect(
      await extractLinkDestination(raw, snapshot(differentRaw), async () => differentRaw),
    ).toHaveProperty("evidence");
  });

  it("requires matching labels and destinations on the same DOM anchor", async () => {
    const request = requestedDestination(instruction.replace("URL", "raw href"), schema)!;
    const swapped = { ...guide, xpath: "/html[1]/body[1]/a[2]", raw: guide.href };
    await expect(
      extractLinkDestination(request, snapshot([guide]), async () => [swapped]),
    ).rejects.toThrow("inconsistent");
  });

  it("parses paired quotes and keeps question punctuation inside a label", () => {
    for (const [open, close] of [
      ["'", "'"],
      ["‘", "’"],
      ['"', '"'],
      ["“", "”"],
    ]) {
      expect(
        requestedDestination(
          `What is the URL of the link named ${open}What's new?${close}?`,
          optional,
        )?.target,
      ).toBe("What's new?");
    }
    expect(requestedDestination("What is the URL of the link named Guide?", optional)?.target).toBe(
      "Guide",
    );
    expect(
      requestedDestination("What is the URL of the link named ‘Guide'?", optional),
    ).toBeUndefined();
  });

  it("rejects a changed destination, a new duplicate, or a changed label between reads", async () => {
    const request = requestedDestination(instruction, schema)!;
    for (const live of [
      [{ ...guide, href: "https://example.com/other" }],
      [guide, guide],
      [{ ...guide, name: "Other" }],
      [],
    ]) {
      await expect(
        extractLinkDestination(request, snapshot([guide]), async () => live),
      ).rejects.toThrow("inconsistent");
    }
  });

  it("omits an optional literal with no unambiguous destination", async () => {
    const request = requestedDestination(instruction, optional)!;
    for (const anchors of [[], [guide, { ...guide, href: "https://example.com/v2", raw: "/v2" }]]) {
      expect(await extractLinkDestination(request, snapshot(anchors), async () => anchors)).toEqual(
        { data: {} },
      );
    }
    const missingRequired = requestedDestination(instruction, schema)!;
    expect(
      await extractLinkDestination(missingRequired, snapshot([]), async () => []),
    ).toHaveProperty("evidence");
  });

  it("leaves conditions and descriptive labels to inference with the verified attributes", async () => {
    for (const prompt of [
      'Copy the URL of the link named "Guide". If the address has a fragment, return the label.',
      "Copy the URL behind the guide credit.",
    ]) {
      const request = requestedDestination(prompt, schema)!;
      const result = await extractLinkDestination(request, snapshot([guide]), async () => [guide]);
      expect(result).toHaveProperty("evidence", expect.stringContaining(guide.href));
    }
  });

  it("keeps every qualifier when the user names a missing link", async () => {
    const request = requestedDestination("Return the URL of the Guide Revised link.", optional)!;
    const read = vi.fn(async (pattern: string) =>
      [guide].filter((link) => new RegExp(pattern, "iu").test(link.name)),
    );
    expect(await extractLinkDestination(request, snapshot([guide]), read)).toHaveProperty(
      "evidence",
    );
    const revised = { ...guide, name: "Read the Guide Revised edition" };
    expect(
      await extractLinkDestination(request, snapshot([revised]), async () => [revised]),
    ).toHaveProperty("evidence");
  });

  it("cannot prove a described repository link is absent from its wording", async () => {
    const request = requestedDestination(
      "Return the URL of the Flask source repository link.",
      optional,
    )!;
    const anchor = { ...guide, name: "Source on GitHub" };
    expect(
      await extractLinkDestination(request, snapshot([anchor]), async () => []),
    ).toHaveProperty("evidence");
  });

  it("requires one frame before reading document-wide anchors", async () => {
    const request = requestedDestination(instruction, schema)!;
    const read = vi.fn();
    await expect(
      extractLinkDestination(request, { ...snapshot([]), perFrame: [] }, read),
    ).rejects.toThrow("scope");
    expect(read).not.toHaveBeenCalled();
  });
});
