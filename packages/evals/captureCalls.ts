/**
 * Eval-only primitive-call capture for the auto-mode V1 offline router eval.
 *
 * When EVAL_CAPTURE_CALLS_PATH is set, wraps a V3 instance's public
 * act/extract/observe methods to append one JSONL line per call with the
 * exact inputs the Stagehand API's complexity scorer sees (instruction,
 * JSON-schema form of the extract schema, variables, page URL at call time)
 * before delegating to the original method. No-op when the env var is unset.
 *
 * Deterministic acts (Action-object input) are recorded with
 * `deterministic: true` so downstream scoring can exclude them — the API
 * excludes them from auto-mode routing by construction.
 */

import { appendFileSync } from "node:fs";

import type {
  ActOptions,
  Action,
  ExtractOptions,
  ObserveOptions,
  StagehandZodSchema,
  V3,
  Variables,
} from "@browserbasehq/stagehand";
import {
  defaultExtractSchema,
  pageTextSchema,
  toJsonSchema,
} from "@browserbasehq/stagehand";

interface CapturedCall {
  taskName: string;
  primitive: "act" | "extract" | "observe";
  instruction?: string;
  schemaJson?: unknown;
  variables?: Variables;
  pageUrl?: string;
  deterministic?: boolean;
  ts: string;
}

function currentPageUrl(
  v3: V3,
  optionsPage?: { url?: () => string },
): string | undefined {
  try {
    if (optionsPage && typeof optionsPage.url === "function") {
      return optionsPage.url();
    }
    return v3.context.pages()[0]?.url();
  } catch {
    return undefined;
  }
}

function appendCapture(path: string, call: CapturedCall): void {
  try {
    appendFileSync(path, `${JSON.stringify(call)}\n`, "utf8");
  } catch {
    // Capture must never fail an eval run.
  }
}

const isZodSchema = (val: unknown): val is StagehandZodSchema =>
  !!val && typeof val === "object" && "parse" in val && "safeParse" in val;

function safeSchemaJson(schema: StagehandZodSchema): unknown {
  try {
    return toJsonSchema(schema);
  } catch {
    return undefined;
  }
}

export function maybeWrapV3ForCapture(v3: V3, taskName: string): void {
  const capturePath = process.env.EVAL_CAPTURE_CALLS_PATH;
  if (!capturePath) {
    return;
  }

  const originalAct = v3.act.bind(v3);
  v3.act = ((input: string | Action, options?: ActOptions) => {
    appendCapture(capturePath, {
      taskName,
      primitive: "act",
      instruction: typeof input === "string" ? input : undefined,
      variables: options?.variables,
      pageUrl: currentPageUrl(v3, options?.page as { url?: () => string }),
      deterministic: typeof input !== "string" || undefined,
      ts: new Date().toISOString(),
    });
    return originalAct(input as string, options);
  }) as V3["act"];

  const originalExtract = v3.extract.bind(v3);
  v3.extract = ((
    a?: string | ExtractOptions,
    b?: StagehandZodSchema | ExtractOptions,
    c?: ExtractOptions,
  ) => {
    const instruction = typeof a === "string" ? a : undefined;
    const schema = isZodSchema(b) ? b : undefined;
    const options =
      typeof a === "string" ? (isZodSchema(b) ? c : (b as ExtractOptions)) : a;
    // Mirror the SDK's schema defaulting so the captured schema matches the
    // JSON schema the API request carries into the server-side scorer.
    const effectiveSchema =
      schema ?? (instruction ? defaultExtractSchema : pageTextSchema);
    appendCapture(capturePath, {
      taskName,
      primitive: "extract",
      instruction,
      schemaJson: safeSchemaJson(effectiveSchema),
      pageUrl: currentPageUrl(v3, options?.page as { url?: () => string }),
      ts: new Date().toISOString(),
    });
    return originalExtract(
      a as string,
      b as StagehandZodSchema,
      c,
    ) as ReturnType<V3["extract"]>;
  }) as V3["extract"];

  const originalObserve = v3.observe.bind(v3);
  v3.observe = ((a?: string | ObserveOptions, b?: ObserveOptions) => {
    const instruction = typeof a === "string" ? a : undefined;
    const options = typeof a === "string" ? b : a;
    appendCapture(capturePath, {
      taskName,
      primitive: "observe",
      instruction,
      variables: options?.variables,
      pageUrl: currentPageUrl(v3, options?.page as { url?: () => string }),
      ts: new Date().toISOString(),
    });
    return originalObserve(a as string, b);
  }) as V3["observe"];
}
