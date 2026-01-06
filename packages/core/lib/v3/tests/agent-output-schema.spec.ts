import { test, expect } from "@playwright/test";
import { V3 } from "../v3";
import { v3TestConfig } from "./v3.config";
import { z } from "zod";
import type { AgentResult } from "../types/public/agent";

// Use OpenAI model for reliability
const TEST_MODEL = "openai/gpt-4.1-mini";

// Skip all tests if no API key is available
const hasApiKey = !!process.env.OPENAI_API_KEY;

test.describe("Stagehand agent outputSchema behavior", () => {
  // Skip all tests in this describe block if no API key
  test.skip(!hasApiKey, "Skipping - no LLM API key configured");

  let v3: V3;

  test.beforeEach(async () => {
    v3 = new V3({
      ...v3TestConfig,
      experimental: true, // Required for streaming tests
    });
    await v3.init();
  });

  test.afterEach(async () => {
    await v3?.close?.().catch(() => {});
  });

  test.describe("Non-streaming mode with outputSchema", () => {
    test("execute with outputSchema returns typed output", async () => {
      test.setTimeout(90000);

      const PageInfoSchema = z.object({
        title: z.string().describe("The page title"),
        hasContent: z.boolean().describe("Whether the page has content"),
      });

      const agent = v3.agent({
        model: TEST_MODEL,
      });

      const page = v3.context.pages()[0];
      await page.goto("https://example.com");

      const result = await agent.execute({
        instruction:
          "Verify this page has loaded. Use close tool with taskComplete: true.",
        maxSteps: 5,
        outputSchema: PageInfoSchema,
      });

      // Result should have output property
      expect(result).toHaveProperty("output");

      // Output should match schema structure
      if (result.output) {
        const output = result.output as z.infer<typeof PageInfoSchema>;
        expect(typeof output.title).toBe("string");
        expect(typeof output.hasContent).toBe("boolean");
      }
    });

    test("execute with array schema extracts multiple items", async () => {
      test.setTimeout(90000);

      const LinksSchema = z.object({
        links: z
          .array(
            z.object({
              text: z.string(),
              href: z.string().optional(),
            })
          )
          .describe("Links on the page"),
        count: z.number().describe("Number of links"),
      });

      const agent = v3.agent({
        model: TEST_MODEL,
      });

      const page = v3.context.pages()[0];
      await page.goto("https://example.com");

      const result = await agent.execute({
        instruction:
          "Look at this page. Use close tool with taskComplete: true.",
        maxSteps: 5,
        outputSchema: LinksSchema,
      });

      expect(result).toHaveProperty("output");

      if (result.output) {
        const output = result.output as z.infer<typeof LinksSchema>;
        expect(Array.isArray(output.links)).toBe(true);
        expect(typeof output.count).toBe("number");
      }
    });

    test("execute without outputSchema returns undefined output", async () => {
      test.setTimeout(60000);

      const agent = v3.agent({
        model: TEST_MODEL,
      });

      const page = v3.context.pages()[0];
      await page.goto("https://example.com");

      const result = await agent.execute({
        instruction: "Use close tool with taskComplete: true immediately.",
        maxSteps: 3,
      });

      // Output should be undefined when no schema provided
      expect(result.output).toBeUndefined();
    });

    test("outputSchema extraction handles missing data gracefully", async () => {
      test.setTimeout(90000);

      // Schema asking for data that doesn't exist on the page
      const FlightSchema = z.object({
        flightNumber: z.string().describe("The flight number"),
        gate: z.string().describe("Departure gate"),
      });

      const agent = v3.agent({
        model: TEST_MODEL,
      });

      const page = v3.context.pages()[0];
      await page.goto("https://example.com");

      // Should not throw - graceful handling
      const result = await agent.execute({
        instruction:
          "Look at this page. Use close tool with taskComplete: true.",
        maxSteps: 3,
        outputSchema: FlightSchema,
      });

      // Agent should complete without crashing
      expect(result).toHaveProperty("success");
      expect(result).toHaveProperty("completed");

      // Output may be present with empty/default values or undefined
      // Either is acceptable behavior
      if (result.output) {
        const output = result.output as z.infer<typeof FlightSchema>;
        // Should have string properties (possibly empty)
        expect(typeof output.flightNumber).toBe("string");
        expect(typeof output.gate).toBe("string");
      }
    });
  });

  test.describe("Streaming mode with outputSchema", () => {
    test("streaming execute with outputSchema populates output after completion", async () => {
      test.setTimeout(90000);

      const PageSchema = z.object({
        title: z.string().describe("Page title"),
        description: z.string().optional().describe("Page description"),
      });

      const agent = v3.agent({
        stream: true,
        model: TEST_MODEL,
      });

      const page = v3.context.pages()[0];
      await page.goto("https://example.com");

      const streamResult = await agent.execute({
        instruction:
          "What is this page about? Use close tool with taskComplete: true after answering.",
        maxSteps: 5,
        outputSchema: PageSchema,
      });

      // Consume the stream first
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _ of streamResult.textStream) {
        // Just consume
      }

      // Get final result
      const finalResult: AgentResult = await streamResult.result;

      // Should have output after stream completes
      expect(finalResult).toHaveProperty("output");

      if (finalResult.output) {
        const output = finalResult.output as z.infer<typeof PageSchema>;
        expect(typeof output.title).toBe("string");
      }
    });

    test("streaming without outputSchema returns undefined output", async () => {
      test.setTimeout(60000);

      const agent = v3.agent({
        stream: true,
        model: TEST_MODEL,
      });

      const page = v3.context.pages()[0];
      await page.goto("https://example.com");

      const streamResult = await agent.execute({
        instruction: "Use close tool with taskComplete: true immediately.",
        maxSteps: 3,
      });

      // Consume the stream
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _ of streamResult.textStream) {
        // Just consume
      }

      const finalResult = await streamResult.result;

      // Output should be undefined
      expect(finalResult.output).toBeUndefined();
    });
  });

  test.describe("Complex schema types", () => {
    test("nested object schemas are extracted correctly", async () => {
      test.setTimeout(90000);

      const NestedSchema = z.object({
        page: z.object({
          title: z.string(),
          meta: z
            .object({
              hasImages: z.boolean().optional(),
              linkCount: z.number().optional(),
            })
            .optional(),
        }),
      });

      const agent = v3.agent({
        model: TEST_MODEL,
      });

      const page = v3.context.pages()[0];
      await page.goto("https://example.com");

      const result = await agent.execute({
        instruction:
          "Analyze this page. Use close tool with taskComplete: true.",
        maxSteps: 5,
        outputSchema: NestedSchema,
      });

      expect(result).toHaveProperty("output");

      if (result.output) {
        const output = result.output as z.infer<typeof NestedSchema>;
        expect(output).toHaveProperty("page");
        expect(output.page).toHaveProperty("title");
        expect(typeof output.page.title).toBe("string");
      }
    });

    test("optional fields in schema are handled", async () => {
      test.setTimeout(90000);

      const OptionalSchema = z.object({
        title: z.string().describe("The page title"),
        description: z.string().optional().describe("Page description if any"),
        linkCount: z.number().optional().describe("Number of links on the page"),
      });

      const agent = v3.agent({
        model: TEST_MODEL,
      });

      const page = v3.context.pages()[0];
      await page.goto("https://example.com");

      const result = await agent.execute({
        instruction:
          "Look at this page. Use close tool with taskComplete: true.",
        maxSteps: 5,
        outputSchema: OptionalSchema,
      });

      expect(result).toHaveProperty("output");

      if (result.output) {
        const output = result.output as z.infer<typeof OptionalSchema>;
        // Title field should be present
        expect(typeof output.title).toBe("string");
        // Optional fields may or may not be present
        if (output.description !== undefined) {
          expect(typeof output.description).toBe("string");
        }
      }
    });
  });

  test.describe("outputSchema with different agent configurations", () => {
    test("outputSchema works with excludeTools option", async () => {
      test.setTimeout(90000);

      const SimpleSchema = z.object({
        pageLoaded: z.boolean(),
      });

      const agent = v3.agent({
        model: TEST_MODEL,
      });

      const page = v3.context.pages()[0];
      await page.goto("https://example.com");

      const result = await agent.execute({
        instruction: "Use close tool with taskComplete: true.",
        maxSteps: 5,
        outputSchema: SimpleSchema,
        excludeTools: ["scroll"], // Exclude scroll tool
      });

      expect(result).toHaveProperty("output");
    });

    test("outputSchema works alongside callbacks", async () => {
      test.setTimeout(90000);

      const DataSchema = z.object({
        extracted: z.boolean(),
      });

      let stepCount = 0;

      const agent = v3.agent({
        model: TEST_MODEL,
      });

      const page = v3.context.pages()[0];
      await page.goto("https://example.com");

      const result = await agent.execute({
        instruction: "Use close tool with taskComplete: true.",
        maxSteps: 5,
        outputSchema: DataSchema,
        callbacks: {
          onStepFinish: async () => {
            stepCount++;
          },
        },
      });

      // Both callbacks and outputSchema should work
      expect(stepCount).toBeGreaterThan(0);
      expect(result).toHaveProperty("output");
    });
  });

  test.describe("AgentResult type with output", () => {
    test("result.output has correct type when schema is provided", async () => {
      test.setTimeout(90000);

      const TypedSchema = z.object({
        stringField: z.string(),
        numberField: z.number(),
        boolField: z.boolean(),
      });

      type ExpectedOutput = z.infer<typeof TypedSchema>;

      const agent = v3.agent({
        model: TEST_MODEL,
      });

      const page = v3.context.pages()[0];
      await page.goto("https://example.com");

      const result = await agent.execute({
        instruction: "Use close tool with taskComplete: true.",
        maxSteps: 5,
        outputSchema: TypedSchema,
      });

      if (result.output) {
        // TypeScript should recognize output as matching the schema
        const typedOutput = result.output as ExpectedOutput;

        // These type checks would fail at compile time if types are wrong
        const _str: string = typedOutput.stringField;
        const _num: number = typedOutput.numberField;
        const _bool: boolean = typedOutput.boolField;

        // Runtime verification
        expect(typeof _str).toBe("string");
        expect(typeof _num).toBe("number");
        expect(typeof _bool).toBe("boolean");
      }
    });
  });
});
