import { z } from "zod/v4";

/**
 * This file intentionally carries the same contract twice:
 *
 * - The JSON-schema literals below are the WIRE contract — the exact bytes
 *   advertised to MCP clients via tools/list. They are hand-written because
 *   the `const`-typed `op` discriminators, property guidance, and cross-field
 *   refinement are part of the model prompt as well as runtime validation.
 *   Their wording is pinned string-exact to the reference contract (models
 *   are prompted against these descriptions) — see
 *   tests/facade-contract.test.ts. One deliberate deviation is documented on
 *   RUN_INPUT_SCHEMA below.
 *
 * - The Zod schemas at the bottom are the RUNTIME validators: they parse
 *   tools/call arguments into typed values and enforce what the wire schema
 *   states (e.g. the code/actions exclusivity via `.refine`).
 *
 * If you change one half, change the other; the contract test exists to
 * catch drift between them.
 */
const actionSchema = (op: string, extra: Record<string, Record<string, unknown>> = {}) => ({
  type: "object",
  properties: {
    op: {
      const: op,
      description: `Action operation. Use "op": "${op}"; never use a "kind" field.`,
    },
    id: {
      type: "string",
      description:
        'Bracketed ID copied from the latest snapshot, as a string. Use "id"; never use "ref".',
    },
    ...extra,
  },
  required: ["op", "id", ...Object.keys(extra).filter((key) => key !== "delay")],
  additionalProperties: false,
});

export const RUN_TOOL_DESCRIPTION =
  'Browse and automate websites in the persistent Stagehand browser. Navigate with JavaScript such as await page.goto("https://example.com"); there is no separate navigate or start tool. Execute either a JavaScript workflow against the Stagehand Playwright facade or a batch of actions using IDs from the latest snapshot. Provide exactly one of code or actions. Each action must use "op" (never "kind") and "id" (never "ref"). Copy the bracketed snapshot ID as a string. Examples: {"actions":[{"op":"click","id":"1-42"}]}, {"actions":[{"op":"fill","id":"2-14","value":"Miami"}]}, {"actions":[{"op":"select","id":"3-9","values":"Lowest price"}]}.';

export const SNAPSHOT_TOOL_DESCRIPTION =
  "Capture the active page's Stagehand accessibility tree and hydrate its displayed IDs for subsequent run actions. Every call replaces the active page's ID map.";

export const SCREENSHOT_TOOL_DESCRIPTION =
  'Capture a screenshot of the active page. For size-constrained MCP clients, prefer a viewport JPEG: {"type":"jpeg","quality":40,"fullPage":false}.';

export const RUN_INPUT_SCHEMA = {
  type: "object",
  properties: {
    code: { type: "string", minLength: 1 },
    actions: {
      type: "array",
      description:
        'Snapshot actions with the exact fields "op" and "id". Do not use "kind" or "ref".',
      items: {
        oneOf: [
          actionSchema("click"),
          actionSchema("hover"),
          actionSchema("fill", { value: { type: "string" } }),
          actionSchema("type", {
            text: { type: "string" },
            delay: { type: "number", minimum: 0 },
          }),
          actionSchema("press", { key: { type: "string" } }),
          actionSchema("select", {
            values: {
              oneOf: [
                { type: "string" },
                { type: "array", items: { type: "string" }, minItems: 1 },
              ],
            },
          }),
        ],
      },
      minItems: 1,
    },
  },
  // Deliberate deviation from the reference contract: no top-level
  // `oneOf: [{required:["code"]},{required:["actions"]}]` here. AI-SDK-based
  // MCP clients (Eve, Vercel AI SDK) reject tool input schemas with a
  // top-level oneOf, failing every `run` call client-side before it reaches
  // the server. The code/actions exclusivity is stated in the description
  // and enforced at runtime by CodeModeRunInputSchema's `.refine`.
  additionalProperties: false,
} as const;

export const SNAPSHOT_INPUT_SCHEMA = {
  type: "object",
  properties: { includeIframes: { type: "boolean", default: true } },
  additionalProperties: false,
} as const;

export const SCREENSHOT_INPUT_SCHEMA = {
  type: "object",
  properties: {
    fullPage: { type: "boolean" },
    type: { type: "string", enum: ["png", "jpeg"] },
    quality: { type: "number", minimum: 0, maximum: 100 },
  },
  additionalProperties: false,
} as const;

export const FACADE_TOOLS = [
  { name: "run", description: RUN_TOOL_DESCRIPTION, inputSchema: RUN_INPUT_SCHEMA },
  {
    name: "snapshot",
    description: SNAPSHOT_TOOL_DESCRIPTION,
    inputSchema: SNAPSHOT_INPUT_SCHEMA,
  },
  {
    name: "screenshot",
    description: SCREENSHOT_TOOL_DESCRIPTION,
    inputSchema: SCREENSHOT_INPUT_SCHEMA,
  },
] as const;

/**
 * Canonical agent system prompt for the facade tool surface. Host examples
 * (Eve, Vercel AI SDK, deepagents) should use this text rather than authoring
 * their own so agent guidance stays identical across frameworks.
 */
export const FACADE_AGENT_INSTRUCTIONS = `You control one persistent browser through exactly three tools:
- snapshot: inspect the active page and hydrate bracketed element IDs.
- run: provide either snapshot actions or JavaScript using the Playwright-shaped page API.
- screenshot: inspect the rendered page visually.

Use snapshot actions for simple interactions and run code for multi-step workflows. Pass run exactly one of code or actions; every action uses "op" and "id", never "kind" or "ref". Snapshot IDs are valid only for the latest snapshot of the active page; snapshot again after navigation or stale IDs. Do not launch another browser.`;

export const NO_HYDRATED_SNAPSHOT_ERROR =
  "No hydrated snapshot exists for the active page; call snapshot first.";
export const NAVIGATED_SNAPSHOT_ERROR =
  "The active page navigated after its snapshot; call snapshot again.";
export const STALE_SNAPSHOT_ID_ERROR =
  'Snapshot ID "${id}" is stale or not actionable; call snapshot again.';

export function staleSnapshotIdError(id: string): string {
  return STALE_SNAPSHOT_ID_ERROR.replace("${id}", id);
}

export const RefActionSchema = z.discriminatedUnion("op", [
  z.strictObject({ op: z.literal("click"), id: z.string().min(1) }),
  z.strictObject({ op: z.literal("hover"), id: z.string().min(1) }),
  z.strictObject({ op: z.literal("fill"), id: z.string().min(1), value: z.string() }),
  z.strictObject({
    op: z.literal("type"),
    id: z.string().min(1),
    text: z.string(),
    delay: z.number().nonnegative().optional(),
  }),
  z.strictObject({ op: z.literal("press"), id: z.string().min(1), key: z.string().min(1) }),
  z.strictObject({
    op: z.literal("select"),
    id: z.string().min(1),
    values: z.union([z.string(), z.array(z.string()).min(1)]),
  }),
]);

export const CodeModeRunInputSchema = z
  .strictObject({
    code: z.string().min(1).optional(),
    actions: z.array(RefActionSchema).min(1).optional(),
  })
  .refine((input) => (input.code === undefined) !== (input.actions === undefined), {
    message: "run requires exactly one of code or actions",
  });

export const SnapshotInputSchema = z.strictObject({
  includeIframes: z.boolean().optional(),
});

export const ScreenshotInputSchema = z.strictObject({
  fullPage: z.boolean().optional(),
  type: z.enum(["png", "jpeg"]).optional(),
  quality: z.number().min(0).max(100).optional(),
});

export type RefAction = z.infer<typeof RefActionSchema>;
export type CodeModeRunInput = z.infer<typeof CodeModeRunInputSchema>;
