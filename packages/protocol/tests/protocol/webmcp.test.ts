import { describe, expect, it } from "vitest";
import {
  WebMCPInvocationDescriptorSchema,
  WebMCPInvocationStatusSchema,
  WebMCPInvokeOptionsSchema,
  WebMCPResultOptionsSchema,
  WebMCPToolDescriptorSchema,
  WebMCPToolResponseSchema,
  WebMCPToolsOptionsSchema,
} from "../../schemas.js";
import { StagehandMethods } from "../../schema-registry.js";

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

  it("defaults missing invocation input to an empty object", () => {
    expect(WebMCPInvokeOptionsSchema.parse({})).toStrictEqual({ input: {} });
    expect(
      WebMCPInvocationDescriptorSchema.parse({
        invocationId: "invocation-1",
        toolName: "search",
        frameId: "frame-1",
        input: { searchQuery: "Stagehand" },
      }),
    ).toStrictEqual({
      invocationId: "invocation-1",
      toolName: "search",
      frameId: "frame-1",
      input: { searchQuery: "Stagehand" },
    });
  });

  it("requires invocation input to be JSON-compatible", () => {
    expect(() =>
      WebMCPInvokeOptionsSchema.parse({
        input: { search: () => "Stagehand" },
      }),
    ).toThrow();
  });

  it("preserves the exact CDP terminal statuses", () => {
    for (const status of ["Completed", "Canceled", "Error"]) {
      expect(WebMCPInvocationStatusSchema.parse(status)).toBe(status);
    }
    expect(() => WebMCPInvocationStatusSchema.parse("completed")).toThrow();
    expect(() => WebMCPInvocationStatusSchema.parse("Pending")).toThrow();
  });

  it("validates terminal responses without registration debug data", () => {
    expect(
      WebMCPToolResponseSchema.parse({
        invocationId: "invocation-1",
        status: "Error",
        errorText: "Tool failed",
        exception: {
          type: "object",
          description: "Error: Tool failed",
          value: { originalKey: "unchanged" },
        },
      }),
    ).toStrictEqual({
      invocationId: "invocation-1",
      status: "Error",
      errorText: "Tool failed",
      exception: {
        type: "object",
        description: "Error: Tool failed",
        value: { originalKey: "unchanged" },
      },
    });
  });

  it("accepts an omitted result timeout and rejects invalid values", () => {
    expect(WebMCPResultOptionsSchema.parse({})).toStrictEqual({});
    expect(WebMCPResultOptionsSchema.parse({ timeout: 0 })).toStrictEqual({ timeout: 0 });
    expect(() => WebMCPResultOptionsSchema.parse({ timeout: -1 })).toThrow();
    expect(() => WebMCPResultOptionsSchema.parse({ timeout: Number.POSITIVE_INFINITY })).toThrow();
  });

  it("registers all WebMCP page methods with strict params and results", () => {
    expect(StagehandMethods.pageWebMCPTools.name).toBe("page.webmcp_tools");
    expect(StagehandMethods.pageWebMCPInvokeTool.name).toBe("page.webmcp_invoke_tool");
    expect(StagehandMethods.pageWebMCPInvocationResult.name).toBe("page.webmcp_invocation_result");
    expect(StagehandMethods.pageWebMCPCancelInvocation.name).toBe("page.webmcp_cancel_invocation");

    expect(
      StagehandMethods.pageWebMCPTools.params.parse({
        pageId: "page-1",
        options: {},
      }),
    ).toStrictEqual({
      pageId: "page-1",
      options: { timeout: 1_000 },
    });
    expect(
      StagehandMethods.pageWebMCPTools.result.parse({
        tools: [{ name: "search", description: "Search", frameId: "frame-1" }],
      }),
    ).toStrictEqual({
      tools: [{ name: "search", description: "Search", frameId: "frame-1" }],
    });

    expect(
      StagehandMethods.pageWebMCPInvokeTool.params.parse({
        pageId: "page-1",
        frameId: "frame-1",
        toolName: "search",
      }),
    ).toStrictEqual({
      pageId: "page-1",
      frameId: "frame-1",
      toolName: "search",
      input: {},
    });
    expect(
      StagehandMethods.pageWebMCPInvokeTool.result.parse({
        invocationId: "invocation-1",
        toolName: "search",
        frameId: "frame-1",
        input: {},
      }),
    ).toStrictEqual({
      invocationId: "invocation-1",
      toolName: "search",
      frameId: "frame-1",
      input: {},
    });

    expect(
      StagehandMethods.pageWebMCPInvocationResult.params.parse({
        pageId: "page-1",
        invocationId: "invocation-1",
        options: { timeout: 5_000 },
      }),
    ).toStrictEqual({
      pageId: "page-1",
      invocationId: "invocation-1",
      options: { timeout: 5_000 },
    });
    expect(
      StagehandMethods.pageWebMCPInvocationResult.result.parse({
        invocationId: "invocation-1",
        status: "Completed",
        output: { resultValue: "done" },
      }),
    ).toStrictEqual({
      invocationId: "invocation-1",
      status: "Completed",
      output: { resultValue: "done" },
    });

    expect(
      StagehandMethods.pageWebMCPCancelInvocation.params.parse({
        pageId: "page-1",
        invocationId: "invocation-1",
      }),
    ).toStrictEqual({
      pageId: "page-1",
      invocationId: "invocation-1",
    });
    expect(StagehandMethods.pageWebMCPCancelInvocation.result.parse({ ok: true })).toStrictEqual({
      ok: true,
    });
    expect(() =>
      StagehandMethods.pageWebMCPCancelInvocation.params.parse({
        pageId: "page-1",
        invocationId: "invocation-1",
        toolName: "search",
      }),
    ).toThrow();
  });
});
