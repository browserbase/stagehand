/**
 * Benchmark manifests — the three-axis run matrix.
 *
 * A benchmark is no longer just "a dataset × a model list". Each manifest
 * under benchmarks/ pins the full cross-product the run should cover:
 *
 *   - model        which LLM drives the run (e.g. openai/gpt-4.1-mini)
 *   - harness      what agentic loop drives the task: the Stagehand SDK
 *                  itself, or an external coding harness (claude_code,
 *                  codex) executing against a tool surface
 *   - toolSurface  what the harness uses to control the browser: writing
 *                  code against an SDK (understudy_code = v3, v4_code = v4,
 *                  playwright_code, cdp_code) or calling packaged tools
 *                  (playwright_mcp, chrome_devtools_mcp, browse_cli)
 *
 * Expansion (see expand.ts) produces one run row per valid combination and
 * carries the triple into results/Braintrust metadata, so scores are always
 * attributable to (model, harness, toolSurface) — never just the model.
 */
import { z } from "zod";

export const HARNESSES = ["stagehand", "claude_code", "codex"] as const;
export const HarnessSchema = z.enum(HARNESSES);
export type BenchmarkHarness = z.infer<typeof HarnessSchema>;

/** Mirrors core/contracts/tool.ts ToolSurface, plus the v4 SDK code mode. */
export const TOOL_SURFACES = [
  "understudy_code",
  "v4_code",
  "playwright_code",
  "cdp_code",
  "playwright_mcp",
  "chrome_devtools_mcp",
  "browse_cli",
] as const;
export const ToolSurfaceSchema = z.enum(TOOL_SURFACES);
export type BenchmarkToolSurface = z.infer<typeof ToolSurfaceSchema>;

/** What the benchmark runs: a dataset-backed suite or a task/category glob. */
export const BenchmarkTargetSchema = z.union([
  z.object({
    kind: z.literal("suite"),
    /** Suite key, e.g. "webvoyager", "gaia", "onlineMind2Web", "webtailbench". */
    suite: z.string(),
    /** Row cap (EVAL_MAX_K equivalent). */
    limit: z.number().int().positive().optional(),
    /** Random sample size, applied before limit. */
    sample: z.number().int().positive().optional(),
  }),
  z.object({
    kind: z.literal("tasks"),
    /** Task or category names as the CLI accepts them, e.g. "act", "act/dropdown". */
    include: z.array(z.string()).min(1),
  }),
]);
export type BenchmarkTarget = z.infer<typeof BenchmarkTargetSchema>;

export const BenchmarkManifestSchema = z
  .object({
    name: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "kebab-case name"),
    description: z.string().optional(),
    target: BenchmarkTargetSchema,
    matrix: z.object({
      models: z.array(z.string().regex(/.+\/.+/, "provider/model")).min(1),
      harnesses: z.array(HarnessSchema).min(1),
      toolSurfaces: z.array(ToolSurfaceSchema).min(1),
    }),
    /** Trials per combination. */
    trials: z.number().int().positive().default(1),
  })
  .strict();
export type BenchmarkManifest = z.input<typeof BenchmarkManifestSchema>;
export type ResolvedBenchmarkManifest = z.output<
  typeof BenchmarkManifestSchema
>;

/** One expanded run row: a point in the (model × harness × toolSurface) space. */
export interface BenchmarkCombination {
  benchmark: string;
  model: string;
  harness: BenchmarkHarness;
  toolSurface: BenchmarkToolSurface;
  target: BenchmarkTarget;
  trials: number;
}

/**
 * Not every point in the cross-product is meaningful. The stagehand harness
 * IS the SDK, so its only coherent surfaces are the SDK code modes; external
 * coding harnesses can drive any surface. Returns null when valid, else the
 * reason (surfaced in the plan, so skipped combos are visible, not silent).
 */
export function combinationInvalidReason(
  harness: BenchmarkHarness,
  toolSurface: BenchmarkToolSurface,
): string | null {
  if (harness === "stagehand") {
    if (toolSurface === "understudy_code" || toolSurface === "v4_code") {
      return null;
    }
    return `harness "stagehand" is the SDK itself — pair it with understudy_code (v3) or v4_code, not "${toolSurface}"`;
  }
  return null;
}
