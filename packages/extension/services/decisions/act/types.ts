import type { Action, ActResultData, Variables } from "@browserbasehq/stagehand-protocol/types";
import type { StagehandLogger } from "../../../logger.js";
import type { Page } from "../../../understudy/page.js";
import type { DecisionsConfig } from "../config.js";
import type { AskContext, Snapshot } from "../pick.js";
import type { DecisionsToolDeps } from "../toolAct.js";

/**
 * What the act pipeline is given, what it returns, and the context its steps share.
 */

export type DecisionsActDeps = {
  page: Page;
  logger: StagehandLogger;
  instruction: string;
  variables?: Variables;
  snapshotOptions: Parameters<Page["captureSnapshot"]>[0];
  ensureTimeRemaining: () => void;
  /** Open tab count, so checks can see an action that opened a new tab. */
  openPageCount?: () => number;
  /**
   * Argument-only LLM call: returns the literal text the instruction wants
   * typed (or null). The decision model still chooses the element.
   */
  extractText?: (instruction: string) => Promise<string | null>;
  takeAction: (action: Action) => Promise<ActResultData>;
  /**
   * Resolves when the DOM has settled. The intent request needs no page, so
   * it runs while this is pending; nothing reads or touches the page before it.
   */
  settled?: Promise<void>;
  /** Present when `tools` is on and the act is not scoped to a locator. */
  webmcp?: DecisionsToolDeps;
};

export type DecisionsActOutcome =
  | {
      kind: "done";
      result: ActResultData;
      /** Must not be written to the act cache. */ noCache?: boolean;
      /** The act was a WebMCP tool call; `argumentLlm` when its input came from the LLM. */
      viaTool?: { argumentLlm: boolean };
    }
  | {
      kind: "fallback";
      reason: string;
      /** The LLM's result must not be written to the act cache (a proven no-op is on record). */
      noCache?: boolean;
      /** Already ran and must be kept in the final result. */
      priorActions?: ActResultData["actions"];
      /** The decision model's shortlist; the LLM fallback can look at these instead of the whole page. */
      focusIds?: string[];
    };

export type Done = Extract<DecisionsActOutcome, { kind: "done" }>;

export type Fallback = Extract<DecisionsActOutcome, { kind: "fallback" }>;

export type PipelineContext = AskContext & {
  config: DecisionsConfig;
  deps: DecisionsActDeps;
  /** Every action that already ran, so an error or abstention later never loses one. */
  performed: ActResultData["actions"];
  /** Target readiness already vouched for the page; do not also wait for the settle heuristic. */
  ready?: boolean;
  /** With target readiness the first snapshot depends on nothing, so it is captured while intent is asked. */
  earlySnapshot?: Promise<Snapshot>;
};
