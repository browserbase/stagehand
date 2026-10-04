import type { StagehandLogger } from "../../../logger.js";
import type { JsonValue } from "../client.js";
import type { Snapshot } from "../pick.js";
import type { OutlineNode } from "../tree.js";
import type { JsonSchema } from "./plan.js";

/** What the extract pipeline is given and returns, and the shapes its list handling shares. */

export type DecisionsExtractDeps = {
  logger: StagehandLogger;
  instruction: string;
  schema: JsonSchema;
  snap: Snapshot;
  urlMap: Record<string, string>;
  ensureTimeRemaining: () => void;
  /** Gate the result with the completion yes/no. False returns whatever was copied. */
  gate: boolean;
};

export type DecisionsExtractOutcome =
  | { kind: "done"; data: JsonValue; completed: boolean }
  | { kind: "fallback"; reason: string };

/** An item is one or more adjacent top-level nodes (several for flat runs). */
export type Item = OutlineNode[];

export type Group = { kind: "siblings" | "flat"; role: string; parent: OutlineNode; items: Item[] };

export type Step = { role: string; nth: number };
