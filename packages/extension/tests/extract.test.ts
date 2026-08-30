import { trace } from "@opentelemetry/api";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod/v4";
import { validateDynamicJsonSchema } from "../../protocol/dynamic-json-schema.js";
import type { LLMGenerateParams, LLMGenerateResult } from "../../protocol/types.js";
import type { CacheClient } from "../clients/cacheClient.js";
import { extract } from "../inference.js";
import { StagehandLogger } from "../logger.js";
import { createStructuredOutputContract } from "../llm/structuredOutput.js";
import { createZodStructuredOutputContract } from "../llm/structuredOutput.js";
import * as cacheService from "../services/cacheService.js";
import * as extractService from "../services/extractService.js";
import {
  createUrlAwareExtractionSchema,
  schemaRequiresObject,
  wrapRootSchema,
} from "../services/extractSchemaUrls.js";

describe("extract inference", () => {
  it("runs extraction and completion metadata through structured LLM calls", async () => {
    const generate = vi.fn(async (params: LLMGenerateParams): Promise<LLMGenerateResult> => {
      const name = params.responseFormat?.type === "json_schema" && params.responseFormat.name;

      if (name === "Extraction") {
        return {
          role: "assistant" as const,
          content: { type: "text" as const, text: "structured extraction" },
          outputFormat: "json_schema" as const,
          structuredContent: { heading: "Example Domain" },
          usage: {
            inputTokens: 10,
            outputTokens: 4,
            totalTokens: 14,
            reasoningTokens: 1,
            cachedInputTokens: 2,
          },
        };
      }

      return {
        role: "assistant",
        content: { type: "text", text: "complete" },
        outputFormat: "json_schema",
        structuredContent: { progress: "The heading was extracted", completed: true },
        usage: {
          inputTokens: 3,
          outputTokens: 2,
          totalTokens: 5,
        },
      };
    });

    const result = await extract({
      instruction: "Extract the page heading",
      domElements: "[0-1] heading: Example Domain",
      schema: createZodStructuredOutputContract(
        "Extraction",
        z.object({ heading: z.string() }).required(),
      ),
      generate,
    });

    expect(result).toMatchObject({
      heading: "Example Domain",
      metadata: {
        progress: "The heading was extracted",
        completed: true,
      },
      prompt_tokens: 13,
      completion_tokens: 6,
      reasoning_tokens: 1,
      cached_input_tokens: 2,
    });
    expect(generate).toHaveBeenCalledTimes(2);
    expect(generate.mock.calls[0]?.[0]).toMatchObject({
      responseFormat: { type: "json_schema", name: "Extraction" },
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: expect.stringContaining("[0-1] heading: Example Domain"),
          },
        },
      ],
    });
    expect(generate.mock.calls[1]?.[0]).toMatchObject({
      responseFormat: { type: "json_schema", name: "Metadata" },
    });
  });

  it("validates both structured LLM responses before returning data", async () => {
    const generate = vi.fn(
      async (): Promise<LLMGenerateResult> => ({
        role: "assistant",
        content: { type: "text", text: "invalid" },
        outputFormat: "json_schema",
        structuredContent: { heading: 42 },
      }),
    );

    await expect(
      extract({
        instruction: "Extract the page heading",
        domElements: "[0-1] heading: Example Domain",
        schema: createZodStructuredOutputContract(
          "Extraction",
          z.object({ heading: z.string() }).required(),
        ),
        generate,
      }),
    ).rejects.toThrow();
  });

  it("sends a viewport PNG alongside the accessibility tree", async () => {
    const screenshot = {
      type: "image" as const,
      data: "iVBORw0KGgo=",
      mimeType: "image/png",
    };
    const generate = vi.fn(
      async (params: LLMGenerateParams): Promise<LLMGenerateResult> =>
        structuredResult(
          params.responseFormat?.type === "json_schema" &&
            params.responseFormat.name === "Extraction"
            ? { heading: "Screenshot heading" }
            : { progress: "The heading was extracted", completed: true },
        ),
    );

    await extract({
      instruction: "Extract the heading shown in the screenshot",
      domElements: "[0-1] heading",
      schema: createZodStructuredOutputContract(
        "Extraction",
        z.object({ heading: z.string() }).required(),
      ),
      generate,
      screenshot,
    });

    const extractionRequest = generate.mock.calls[0]?.[0];
    expect(extractionRequest?.systemPrompt).toContain("a screenshot of the current viewport");
    expect(extractionRequest?.messages).toStrictEqual([
      {
        role: "user",
        content: [
          {
            type: "text",
            text: expect.stringContaining(
              "Use the screenshot of the current viewport together with the accessibility tree",
            ),
          },
          screenshot,
        ],
      },
    ]);
    expect(generate.mock.calls[1]?.[0].messages).toEqual([
      expect.objectContaining({
        content: expect.objectContaining({ type: "text" }),
      }),
    ]);
  });
});

describe("extract service", () => {
  it("rewrites only structural URL paths and local references", () => {
    const url = { type: "string", format: "uri" };
    const schema = {
      $defs: { url },
      type: "object",
      properties: {
        direct: { $ref: "#/$defs/url" },
        list: { type: "array", items: { $ref: "#/$defs/url" } },
        tuple: { type: "array", prefixItems: [{ $ref: "#/$defs/url" }] },
        conditional: {
          type: "object",
          if: { required: ["enabled"] },
          // oxlint-disable-next-line unicorn/no-thenable -- Draft 2020-12 conditional keyword.
          then: { properties: { target: { $ref: "#/$defs/url" } } },
          else: { properties: { fallback: { $ref: "#/$defs/url" } } },
        },
        dependent: {
          type: "object",
          dependentSchemas: {
            enabled: { properties: { target: { $ref: "#/$defs/url" } } },
          },
        },
        matches: { type: "array", contains: { $ref: "#/$defs/url" } },
      },
      patternProperties: { "^link": { $ref: "#/$defs/url" } },
      additionalProperties: { $ref: "#/$defs/url" },
    };
    const original = structuredClone(schema);
    const contract = createUrlAwareExtractionSchema(validateDynamicJsonSchema(schema));
    const output = {
      direct: "0-1",
      list: ["0-2"],
      tuple: ["0-3"],
      conditional: { target: "0-4", fallback: "0-5" },
      dependent: { enabled: true, target: "0-6" },
      matches: ["0-7"],
      linkHome: "0-8",
      arbitrary: "0-9",
    };
    const mapping = Object.fromEntries(
      Array.from({ length: 9 }, (_, index) => [
        `0-${index + 1}`,
        `https://example.com/${index + 1}`,
      ]),
    );

    const restored = contract.restoreUrls(output, mapping);
    const originalOutput = {
      direct: "0-1",
      list: ["0-2"],
      tuple: ["0-3"],
      conditional: { target: "0-4", fallback: "0-5" },
      dependent: { enabled: true, target: "0-6" },
      matches: ["0-7"],
      linkHome: "0-8",
      arbitrary: "0-9",
    };

    expect(output).toStrictEqual(originalOutput);
    expect(restored).toStrictEqual({
      direct: "https://example.com/1",
      list: ["https://example.com/2"],
      tuple: ["https://example.com/3"],
      conditional: {
        target: "0-4",
        fallback: "https://example.com/5",
      },
      dependent: { enabled: true, target: "https://example.com/6" },
      matches: ["https://example.com/7"],
      linkHome: "https://example.com/8",
      arbitrary: "https://example.com/9",
    });
    expect(schema).toStrictEqual(original);
    expect(contract.jsonSchema).not.toBe(schema);
    expect(contract.jsonSchema).toMatchObject({
      $defs: { url: { type: "string", pattern: "^\\d+-\\d+$" } },
      properties: {
        direct: { $ref: "#/$defs/url" },
        conditional: {
          // oxlint-disable-next-line unicorn/no-thenable -- Draft 2020-12 conditional keyword.
          then: { properties: { target: { $ref: "#/$defs/url" } } },
          else: { properties: { fallback: { $ref: "#/$defs/url" } } },
        },
        dependent: {
          dependentSchemas: {
            enabled: { properties: { target: { $ref: "#/$defs/url" } } },
          },
        },
        matches: { contains: { $ref: "#/$defs/url" } },
      },
    });

    const missing = { direct: "0-404" };
    expect(contract.restoreUrls(missing, mapping)).toStrictEqual({ direct: "" });
    expect(missing).toStrictEqual({ direct: "0-404" });
  });

  it("restores URLs only through the selected conditional branch", () => {
    const schema = validateDynamicJsonSchema({
      type: "object",
      properties: {
        conditional: {
          type: "object",
          properties: { target: { type: "string" } },
          if: { required: ["enabled"] },
          // oxlint-disable-next-line unicorn/no-thenable -- Draft 2020-12 conditional keyword.
          then: { properties: { target: { type: "string", format: "uri" } } },
          else: { properties: { target: { type: "string", pattern: "^\\d+-\\d+$" } } },
        },
      },
      required: ["conditional"],
    });
    const contract = createUrlAwareExtractionSchema(schema);
    const restored = contract.restoreUrls(
      { conditional: { target: "0-1" } },
      { "0-1": "https://example.com" },
    );

    expect(restored).toStrictEqual({ conditional: { target: "0-1" } });
    expect(createStructuredOutputContract("conditional", schema).validate(restored)).toMatchObject({
      value: restored,
    });
  });

  it("restores URLs only through matching composition branches", () => {
    for (const keyword of ["anyOf", "oneOf"] as const) {
      const schema = validateDynamicJsonSchema({
        [keyword]: [
          {
            properties: {
              kind: { const: "url" },
              value: { type: "string", format: "uri" },
            },
            required: ["kind", "value"],
          },
          {
            properties: {
              kind: { const: "text" },
              value: { type: "string", pattern: "^\\d+-\\d+$" },
            },
            required: ["kind", "value"],
          },
        ],
      });
      const contract = createUrlAwareExtractionSchema(schema);
      const mapping = { "0-1": "https://example.com" };

      expect(contract.restoreUrls({ kind: "text", value: "0-1" }, mapping)).toStrictEqual({
        kind: "text",
        value: "0-1",
      });
      expect(contract.restoreUrls({ kind: "url", value: "0-1" }, mapping)).toStrictEqual({
        kind: "url",
        value: "https://example.com",
      });
    }
  });

  it("wraps non-object roots with relocated definitions and without mutation", () => {
    const schema = {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $defs: { item: { type: "string" } },
      type: "array",
      items: { $ref: "#/$defs/item" },
    };
    const original = structuredClone(schema);
    const wrapped = wrapRootSchema(schema, "value");

    expect(wrapped).toMatchObject({
      type: "object",
      properties: {
        value: {
          $defs: schema.$defs,
          type: "array",
          items: { $ref: "#/properties/value/$defs/item" },
        },
      },
      required: ["value"],
    });
    expect(schema).toStrictEqual(original);
  });

  it("recognizes object roots through local references and compositions", () => {
    const referenced = validateDynamicJsonSchema({
      $defs: { result: { type: "object", properties: { name: { type: "string" } } } },
      $ref: "#/$defs/result",
    });
    const intersected = validateDynamicJsonSchema({
      allOf: [{ type: "object" }, { properties: { name: { type: "string" } } }],
    });
    const objectUnion = validateDynamicJsonSchema({
      oneOf: [{ type: "object" }, { $ref: "#/$defs/result" }],
      $defs: { result: { type: "object" } },
    });

    expect(schemaRequiresObject(referenced)).toBe(true);
    expect(schemaRequiresObject(intersected)).toBe(true);
    expect(schemaRequiresObject(objectUnion)).toBe(true);
  });

  it("wraps nullable and mixed roots that may produce non-object values", () => {
    for (const schema of [
      { type: "array" },
      { type: ["object", "null"] },
      { anyOf: [{ type: "object" }, { type: "string" }] },
    ]) {
      expect(schemaRequiresObject(validateDynamicJsonSchema(schema))).toBe(false);
    }
  });

  it("preserves root self-references when wrapping a non-object schema", async () => {
    const schema = validateDynamicJsonSchema({
      anyOf: [{ type: "string" }, { type: "array", items: { $ref: "#" } }],
    });
    const wrapped = wrapRootSchema(schema, "value");
    const contract = createStructuredOutputContract("recursive root", wrapped);

    expect(contract.validate({ value: ["one", ["two"]] })).toMatchObject({
      value: { value: ["one", ["two"]] },
    });
    expect(schema).toStrictEqual({
      anyOf: [{ type: "string" }, { type: "array", items: { $ref: "#" } }],
    });
  });

  it("restores URL fields at every depth of a recursive schema", async () => {
    const schema = validateDynamicJsonSchema({
      $defs: {
        node: {
          type: "object",
          properties: {
            url: { type: "string", format: "uri" },
            children: { type: "array", items: { $ref: "#/$defs/node" } },
          },
          required: ["url", "children"],
          additionalProperties: false,
        },
      },
      $ref: "#/$defs/node",
    });
    const wrapped = wrapRootSchema(schema, "value");
    const contract = createUrlAwareExtractionSchema(wrapped);
    const output = {
      value: {
        url: "0-1",
        children: [{ url: "0-2", children: [{ url: "0-3", children: [] }] }],
      },
    };
    const restored = contract.restoreUrls(output, {
      "0-1": "https://example.com/one",
      "0-2": "https://example.com/two",
      "0-3": "https://example.com/three",
    });

    expect(restored).toEqual({
      value: {
        url: "https://example.com/one",
        children: [
          {
            url: "https://example.com/two",
            children: [{ url: "https://example.com/three", children: [] }],
          },
        ],
      },
    });
    expect(output.value.url).toBe("0-1");
    expect(
      createStructuredOutputContract("recursive URLs", wrapped).validate(restored),
    ).toMatchObject({ value: restored });
  });

  it("rejects non-object roots whose identifier scope cannot be relocated safely", () => {
    expect(() =>
      wrapRootSchema({ $id: "https://example.com/root", type: "string" }, "value"),
    ).toThrow(/relocation would change its reference scope/);
  });

  it("accepts recursive JSON Schemas sent by SDKs", async () => {
    const schema = {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $defs: {
        node: {
          type: "object",
          properties: {
            value: { type: "string" },
            children: {
              type: "array",
              items: { $ref: "#/$defs/node" },
            },
          },
          required: ["value"],
          additionalProperties: false,
        },
      },
      $ref: "#/$defs/node",
    };

    const urlContract = createUrlAwareExtractionSchema(validateDynamicJsonSchema(schema));
    const transformedJsonSchema = urlContract.jsonSchema;
    const transformed = createStructuredOutputContract(
      "recursive extraction",
      transformedJsonSchema,
    );

    expect(
      transformed.validate({
        value: "root",
        children: [{ value: "child", children: [] }],
      }),
    ).toMatchObject({
      value: {
        value: "root",
        children: [{ value: "child", children: [] }],
      },
    });
    expect(transformedJsonSchema).toStrictEqual(schema);
  });

  it("captures and forwards a screenshot through a client-provided LLM", async () => {
    const withCache = vi.spyOn(cacheService, "withCache");
    const captureSnapshot = vi.fn(async () => ({
      combinedTree: "[0-1] heading",
      combinedXpathMap: {},
      combinedUrlMap: {},
    }));
    const screenshot = vi.fn(
      async () => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
    const clientLLMGenerate = vi.fn(
      async (params: LLMGenerateParams): Promise<LLMGenerateResult> =>
        structuredResult(
          params.responseFormat?.type === "json_schema" &&
            params.responseFormat.name === "Extraction"
            ? { heading: "Screenshot heading" }
            : { progress: "The heading was extracted", completed: true },
        ),
    );

    try {
      await extractService.extract({
        params: {
          pageId: "page-1",
          instruction: "Extract the screenshot heading",
          schema: z.json().parse(z.toJSONSchema(z.object({ heading: z.string() }))),
          options: { screenshot: true },
        },
        page: { captureSnapshot, screenshot },
        model: { source: "client" },
        clientLLMGenerate,
        logger: testLogger(),
      });

      expect(withCache).not.toHaveBeenCalled();
      expect(screenshot).toHaveBeenCalledWith({ fullPage: false, type: "png" });
      expect(clientLLMGenerate.mock.calls[0]?.[0].messages).toEqual([
        {
          role: "user",
          content: [
            expect.objectContaining({ type: "text" }),
            {
              type: "image",
              data: "iVBORw0KGgo=",
              mimeType: "image/png",
            },
          ],
        },
      ]);
    } finally {
      withCache.mockRestore();
    }
  });

  it("checks the extraction timeout after screenshot capture", async () => {
    let currentTime = 0;
    const now = vi.spyOn(Date, "now").mockImplementation(() => currentTime);
    const clientLLMGenerate = vi.fn(async (): Promise<LLMGenerateResult> => structuredResult({}));

    try {
      await expect(
        extractService.extract({
          params: {
            pageId: "page-1",
            instruction: "Extract the heading",
            schema: z.json().parse(z.toJSONSchema(z.object({ heading: z.string() }))),
            options: { screenshot: true, timeout: 5 },
          },
          page: {
            captureSnapshot: async () => ({
              combinedTree: "[0-1] heading",
              combinedXpathMap: {},
              combinedUrlMap: {},
            }),
            screenshot: async () => {
              currentTime = 10;
              return new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
            },
          },
          model: { source: "client" },
          clientLLMGenerate,
          logger: testLogger(),
        }),
      ).rejects.toThrow("extract() timed out after 5ms");
      expect(clientLLMGenerate).not.toHaveBeenCalled();
    } finally {
      now.mockRestore();
    }
  });

  it("checks the extraction timeout after screenshot encoding", async () => {
    let currentTime = 0;
    const now = vi.spyOn(Date, "now").mockImplementation(() => currentTime);
    const btoa = vi.spyOn(globalThis, "btoa").mockImplementation(() => {
      currentTime = 10;
      return "encoded-screenshot";
    });
    const clientLLMGenerate = vi.fn(async (): Promise<LLMGenerateResult> => structuredResult({}));

    try {
      await expect(
        extractService.extract({
          params: {
            pageId: "page-1",
            instruction: "Extract the heading",
            schema: z.json().parse(z.toJSONSchema(z.object({ heading: z.string() }))),
            options: { screenshot: true, timeout: 5 },
          },
          page: {
            captureSnapshot: async () => ({
              combinedTree: "[0-1] heading",
              combinedXpathMap: {},
              combinedUrlMap: {},
            }),
            screenshot: async () => new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
          },
          model: { source: "client" },
          clientLLMGenerate,
          logger: testLogger(),
        }),
      ).rejects.toThrow("extract() timed out after 5ms");
      expect(clientLLMGenerate).not.toHaveBeenCalled();
    } finally {
      btoa.mockRestore();
      now.mockRestore();
    }
  });

  it("returns the standard data and metadata result shape", async () => {
    const generate = vi.fn(async (params: LLMGenerateParams): Promise<LLMGenerateResult> => {
      const name = params.responseFormat?.type === "json_schema" && params.responseFormat.name;
      if (name === "Extraction") {
        return {
          role: "assistant",
          content: { type: "text", text: "structured extraction" },
          outputFormat: "json_schema",
          structuredContent: { count: 1 },
          usage: {
            inputTokens: 1,
            outputTokens: 1,
            totalTokens: 2,
            reasoningTokens: 2,
            cachedInputTokens: 3,
          },
        };
      }
      return {
        role: "assistant",
        content: { type: "text", text: "metadata" },
        outputFormat: "json_schema",
        structuredContent: { progress: "Extracted the count", completed: true },
        usage: {
          inputTokens: 1,
          outputTokens: 1,
          totalTokens: 2,
          reasoningTokens: 5,
          cachedInputTokens: 7,
        },
      };
    });

    const result = await extractService.extract({
      params: {
        pageId: "page-1",
        instruction: "Extract the count",
        schema: z.json().parse(z.toJSONSchema(z.object({ count: z.number() }))),
      },
      page: {
        captureSnapshot: async () => ({
          combinedTree: "[0-1] text: 1",
          combinedXpathMap: {},
          combinedUrlMap: {},
        }),
        screenshot: async () => new Uint8Array(),
      },
      model: { source: "client" },
      clientLLMGenerate: generate,
      logger: new StagehandLogger({ tracer: trace.getTracer("extract-service-test") }, () => {}),
    });

    expect(result).toStrictEqual({
      data: { count: 1 },
      metadata: {
        cache: { status: "DISABLED" },
        usage: {
          inputTokens: 2,
          outputTokens: 2,
          reasoningTokens: 7,
          cachedInputTokens: 10,
          inferenceTimeMs: expect.any(Number),
        },
      },
    });
  });

  it("zeroes usage when a cached result avoids inference", async () => {
    const frame = {
      frameId: "frame-1",
      getAccessibilityTree: vi.fn(async () => []),
    };
    const page = {
      captureSnapshot: vi.fn(),
      screenshot: vi.fn(),
      url: () => "https://example.com",
      frames: () => [frame],
      mainFrame: () => frame,
    };
    const clientLLMGenerate = vi.fn(async (): Promise<LLMGenerateResult> => structuredResult({}));
    const get = vi.fn().mockResolvedValue({
      hit: true,
      cacheKey: "key",
      value: { count: 1 },
    });
    const set = vi.fn();

    const result = await extractService.extract({
      params: {
        pageId: "page-1",
        instruction: "Extract the count",
        schema: z.json().parse(z.toJSONSchema(z.object({ count: z.number() }))),
      },
      page,
      model: { source: "client" },
      clientLLMGenerate,
      logger: testLogger(),
      cache: {
        sessionId: "session-1",
        client: { get, set } as unknown as CacheClient,
        defaultCaching: true,
      },
    });

    expect(result).toStrictEqual({
      data: { count: 1 },
      metadata: {
        cache: { status: "HIT" },
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          reasoningTokens: 0,
          cachedInputTokens: 0,
          inferenceTimeMs: 0,
        },
      },
    });
    expect(page.captureSnapshot).not.toHaveBeenCalled();
    expect(clientLLMGenerate).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "focus locator",
      options: { cache: true, locator: { selector: "main", nth: 1 } },
      expectedSnapshotOptions: {
        focusLocator: { selector: "main", nth: 1 },
        ignoreLocators: undefined,
      },
    },
    {
      name: "ignore locator",
      options: { cache: true, ignoreLocators: [{ selector: "nav", nth: 2 }] },
      expectedSnapshotOptions: {
        focusLocator: undefined,
        ignoreLocators: [{ selector: "nav", nth: 2 }],
      },
    },
  ])(
    "bypasses cache reads and writes for locator-scoped extraction with $name",
    async ({ options, expectedSnapshotOptions }) => {
      const frame = {
        frameId: "frame-1",
        getAccessibilityTree: vi.fn(async () => []),
      };
      const page = {
        captureSnapshot: vi.fn(async () => ({
          combinedTree: "[0-1] text: 1",
          combinedXpathMap: {},
          combinedUrlMap: {},
        })),
        screenshot: vi.fn(),
        url: () => "https://example.com",
        frames: () => [frame],
        mainFrame: () => frame,
      };
      const get = vi.fn();
      const set = vi.fn();
      const clientLLMGenerate = vi.fn(
        async (params: LLMGenerateParams): Promise<LLMGenerateResult> => {
          const name = params.responseFormat?.type === "json_schema" && params.responseFormat.name;
          return structuredResult(
            name === "Extraction"
              ? { count: 1 }
              : { progress: "Extracted the count", completed: true },
          );
        },
      );

      const result = await extractService.extract({
        params: {
          pageId: "page-1",
          instruction: "Extract the count",
          schema: z.json().parse(z.toJSONSchema(z.object({ count: z.number() }))),
          options,
        },
        page,
        model: { source: "client" },
        clientLLMGenerate,
        logger: testLogger(),
        cache: {
          sessionId: "session-1",
          client: { get, set } as unknown as CacheClient,
          defaultCaching: true,
        },
      });

      expect(result.data).toStrictEqual({ count: 1 });
      expect(result.metadata.cache).toStrictEqual({ status: "DISABLED" });
      expect(page.captureSnapshot).toHaveBeenCalledWith(expectedSnapshotOptions);
      expect(clientLLMGenerate).toHaveBeenCalledTimes(2);
      expect(get).not.toHaveBeenCalled();
      expect(set).not.toHaveBeenCalled();
      expect(frame.getAccessibilityTree).not.toHaveBeenCalled();
    },
  );
});

function structuredResult(
  structuredContent: Extract<
    LLMGenerateResult,
    { outputFormat: "json_schema" }
  >["structuredContent"],
): LLMGenerateResult {
  return {
    role: "assistant",
    content: { type: "text", text: JSON.stringify(structuredContent) },
    outputFormat: "json_schema",
    structuredContent,
  };
}

function testLogger(): StagehandLogger {
  return new StagehandLogger({ tracer: trace.getTracer("extract-service-test") }, () => {});
}
