import type {
  Action,
  ActResultData,
  LLMGenerateParams,
  LLMGenerateResult,
  Variables,
} from "@browserbasehq/stagehand-protocol/types";
import type { z } from "zod/v4";
import type { StagehandLogger } from "../../logger.js";
import type { Page } from "../../understudy/page.js";

/**
 * Drivers decide; services do everything around the decision.
 *
 * act(), observe() and extract() each have one question at their core: which action, which
 * elements, which values. A driver answers that question. The service that calls it owns the
 * timeout, the DOM-settle wait, the cache, usage accounting and the result envelope, and knows
 * nothing about how the answer was reached.
 *
 * Two families ship: `llm` (one model call over the page) and `decisions` (typed questions to
 * a decision model). They compose through the combinators in `fallback.ts`, and the controller
 * is the only place that chooses which to hand to a service.
 */

export type SnapshotOptions = Parameters<Page["captureSnapshot"]>[0];

/** Token and time figures every inference helper reports. */
export type InferenceUsage = {
  prompt_tokens: number;
  completion_tokens: number;
  reasoning_tokens: number;
  cached_input_tokens: number;
  inference_time_ms: number;
};

/** The configured language model, as a driver sees it. */
export type LlmPort = {
  generate(params: LLMGenerateParams): Promise<LLMGenerateResult>;
  /** Adds one inference to the operation's reported usage. */
  record(usage: InferenceUsage): void;
  /** The caller's system prompt, empty when none was given. */
  systemPrompt: string;
};

/** A driver either answers or says why it will not. */
export type Abstained = {
  kind: "abstained";
  /** Safe to log and to show: drivers redact variable values before returning it. */
  reason: string;
};

// ---------------------------------------------------------------------------------------------
// act
// ---------------------------------------------------------------------------------------------

export type ActRequest = {
  instruction: string;
  variables?: Variables;
  page: Page;
  snapshotOptions: SnapshotOptions;
  /**
   * Resolves when the DOM has settled. Nothing may read or touch the page before it does; work
   * that needs no page may run while it is pending.
   */
  settled: Promise<void>;
  /** Throws once the caller's timeout has passed. */
  ensureTimeRemaining(): void;
  logger: StagehandLogger;
  llm: LlmPort;
  /**
   * Performs one action on the page. `selfHeal` defaults to the instance setting; a driver
   * that has its own recovery passes `false`.
   */
  runAction(action: Action, options?: { selfHeal?: boolean }): Promise<ActResultData>;
  /** Open tab count, so a driver can see an action that opened a new tab. */
  openPageCount?: () => number;
};

/** What a driver that gave up leaves for the next one. */
export type ActHandoff = {
  /** Actions that already ran (an opened dropdown, say) and belong in the final result. */
  priorActions: Action[];
  /**
   * Reduces a page outline to the part the driver narrowed the choice to, for a driver that can
   * start from a shortlist. Absent when it has none.
   */
  focus?: (tree: string) => string;
  /** False when whatever the next driver does must not be written to the act cache. */
  cacheable: boolean;
};

export type ActResolution =
  | {
      kind: "resolved";
      result: ActResultData;
      /** How the act was resolved, for the timing log: `llm`, `decisions`, `decisions+llm`, ... */
      path: string;
      /** False when the result must not be written to the act cache. */
      cacheable: boolean;
    }
  | (Abstained & { handoff: ActHandoff });

export interface ActDriver {
  readonly name: string;
  /**
   * True when `resolve` may be called before the DOM has settled. Such a driver awaits
   * `request.settled` itself before it reads or touches the page.
   */
  readonly startsBeforeSettle: boolean;
  /**
   * Called once when act() starts, before the settle wait and before any cache lookup. For
   * page-independent warm-up only; a cache hit means `resolve` is never called.
   */
  prepare?(request: ActRequest): void;
  resolve(request: ActRequest, handoff?: ActHandoff): Promise<ActResolution>;
}

/** Vets a cached action against the page as it is now, before it is replayed. */
export interface CachedActionGuard {
  check(
    action: Action,
    request: Pick<
      ActRequest,
      "instruction" | "variables" | "page" | "logger" | "ensureTimeRemaining"
    >,
  ): Promise<{ verdict: "ok" } | { verdict: "stale"; detail: string }>;
}

// ---------------------------------------------------------------------------------------------
// observe
// ---------------------------------------------------------------------------------------------

export type ObserveRequest = {
  /** As the caller gave it; undefined means "everything a user could act on". */
  instruction?: string;
  variables?: Variables;
  page: Pick<Page, "captureSnapshot">;
  snapshotOptions: SnapshotOptions;
  ensureTimeRemaining(): void;
  logger: StagehandLogger;
  llm: LlmPort;
};

export type ObserveResolution = { kind: "resolved"; actions: Action[] } | Abstained;

export interface ObserveDriver {
  readonly name: string;
  resolve(request: ObserveRequest): Promise<ObserveResolution>;
}

// ---------------------------------------------------------------------------------------------
// extract
// ---------------------------------------------------------------------------------------------

export type ExtractRequest = {
  instruction: string;
  /** The caller's schema, as JSON Schema and as the validator built from it. */
  jsonSchema: unknown;
  schema: z.ZodType;
  /** Captured once by the service, so every driver in a chain sees the same page. */
  snapshot: { tree: string; urlMap: Record<string, string> };
  /** Present for screenshot-assisted extraction. */
  screenshot?: Uint8Array;
  ensureTimeRemaining(): void;
  logger: StagehandLogger;
  llm: LlmPort;
};

export type ExtractResolution = { kind: "resolved"; data: unknown } | Abstained;

export interface ExtractDriver {
  readonly name: string;
  resolve(request: ExtractRequest): Promise<ExtractResolution>;
}

/** Decides whether an extraction fulfilled the instruction; replaces the LLM's own check. */
export type CompletionJudge = (extracted: unknown, request: ExtractRequest) => Promise<boolean>;

// ---------------------------------------------------------------------------------------------
// the bundle a service call is wired with
// ---------------------------------------------------------------------------------------------

export type Drivers = {
  act: ActDriver;
  observe: ObserveDriver;
  extract: ExtractDriver;
  /** Checked before each cached action is replayed; none means replay is unconditional. */
  cachedActionGuard?: CachedActionGuard;
  /**
   * Log one line per act with its path, duration and LLM usage. Off by default: the line
   * carries the instruction, which is user content.
   */
  logActTiming?: boolean;
};
