import { describe, expect, it } from "vitest";
import { WebMCPToolDescriptorSchema, WebMCPToolsOptionsSchema } from "../../schemas.js";

describe("WebMCP protocol data", () => {
  it("validates serializable tool descriptors", () => {
    expect(
      WebMCPToolDescriptorSchema.parse({
        name: "search",
        description: "Search the current site",
        inputSchema: {
          type: "object",
          properties: {
            searchQuery: { type: "string" },
          },
        },
        annotations: {
          readOnly: true,
          untrustedContent: true,
          autosubmit: false,
        },
        frameId: "frame-1",
        backendNodeId: 42,
      }),
    ).toStrictEqual({
      name: "search",
      description: "Search the current site",
      inputSchema: {
        type: "object",
        properties: {
          searchQuery: { type: "string" },
        },
      },
      annotations: {
        readOnly: true,
        untrustedContent: true,
        autosubmit: false,
      },
      frameId: "frame-1",
      backendNodeId: 42,
    });
  });

  it("does not admit CDP registration stack traces", () => {
    expect(() =>
      WebMCPToolDescriptorSchema.parse({
        name: "search",
        description: "Search",
        frameId: "frame-1",
        stackTrace: { callFrames: [] },
      }),
    ).toThrow();
  });

  it("requires JSON-compatible input schemas", () => {
    expect(() =>
      WebMCPToolDescriptorSchema.parse({
        name: "search",
        description: "Search",
        frameId: "frame-1",
        inputSchema: {
          parse: () => true,
        },
      }),
    ).toThrow();
  });

  it("defaults the timeout and accepts non-negative finite values", () => {
    expect(WebMCPToolsOptionsSchema.parse({})).toStrictEqual({ timeout: 1_000 });
    expect(WebMCPToolsOptionsSchema.parse({ timeout: 0 })).toStrictEqual({ timeout: 0 });
    expect(WebMCPToolsOptionsSchema.parse({ timeout: 1_000 })).toStrictEqual({ timeout: 1_000 });
    expect(() => WebMCPToolsOptionsSchema.parse({ timeout: -1 })).toThrow();
    expect(() => WebMCPToolsOptionsSchema.parse({ timeout: Number.POSITIVE_INFINITY })).toThrow();
  });
});
