import type { StagehandLogger } from "../../../logger.js";
import type { JsonValue } from "../client.js";
import type { Snapshot } from "../pick.js";
import type { OutlineNode } from "../tree.js";
import type { JsonSchema } from "./plan.js";

export type DecisionsExtractDeps = {
  logger: StagehandLogger;
  instruction: string;
  schema: JsonSchema;
  snap: Snapshot;
  urlMap: Record<string, string>;
  ensureTimeRemaining: () => void;
  gate: boolean;
};

export type DecisionsExtractOutcome =
  | { kind: "done"; data: JsonValue; completed: boolean }
  | { kind: "fallback"; reason: string };

export type Item = OutlineNode[];

export type Group = { kind: "siblings" | "flat"; role: string; parent: OutlineNode; items: Item[] };

export type Step = { role: string; nth: number };
