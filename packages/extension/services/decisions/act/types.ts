import type { Action, ActResultData, Variables } from "@browserbasehq/stagehand-protocol/types";
import type { StagehandLogger } from "../../../logger.js";
import type { Page } from "../../../understudy/page.js";
import type { DecisionsConfig } from "../config.js";
import type { AskContext, Snapshot } from "../pick.js";
import type { DecisionsToolDeps } from "../toolAct.js";

export type DecisionsActDeps = {
  page: Page;
  logger: StagehandLogger;
  instruction: string;
  variables?: Variables;
  snapshotOptions: Parameters<Page["captureSnapshot"]>[0];
  ensureTimeRemaining: () => void;
  openPageCount?: () => number;
  extractText?: (instruction: string) => Promise<string | null>;
  takeAction: (action: Action) => Promise<ActResultData>;
  settled?: Promise<void>;
  webmcp?: DecisionsToolDeps;
};

export type DecisionsActOutcome =
  | {
      kind: "done";
      result: ActResultData;
      noCache?: boolean;
      viaTool?: { argumentLlm: boolean };
    }
  | {
      kind: "fallback";
      reason: string;
      noCache?: boolean;
      priorActions?: ActResultData["actions"];
      focusIds?: string[];
    };

export type Done = Extract<DecisionsActOutcome, { kind: "done" }>;

export type Fallback = Extract<DecisionsActOutcome, { kind: "fallback" }>;

export type PipelineContext = AskContext & {
  config: DecisionsConfig;
  deps: DecisionsActDeps;
  performed: ActResultData["actions"];
  ready?: boolean;
  earlySnapshot?: Promise<Snapshot>;
};
