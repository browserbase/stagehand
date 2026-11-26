import type {
  DecisionChooseParams,
  DecisionChooseResult,
  LocatorChain,
} from "@browserbasehq/stagehand-protocol/types";
import { createDecisionChooseResultSchema } from "@browserbasehq/stagehand-protocol/schemas";
import type { Protocol } from "devtools-protocol";
import {
  InvalidPromptLocatorSelectionError,
  PromptLocatorRefusedError,
  UnsupportedPromptLocatorError,
} from "../errors.js";
import {
  actionForLocatorOperation,
  type ApcLocatorOperation,
} from "./annotatedPageContent/candidates.js";
import type { ApcAction } from "./annotatedPageContent/actions.js";
import type { ApcScope } from "./annotatedPageContent/scopes.js";
import { resolveLocatorChain, type ChainTarget } from "./locatorChain.js";
import type { Page } from "./page.js";
import type { Progress } from "./progress.js";
import { waitForDomNetworkQuiet } from "../handlers/handlerUtils/actHandlerUtils.js";

/** Upper bound for the settle wait before the one re-capture after a miss. */
const RECAPTURE_SETTLE_TIMEOUT_MS = 1000;

export type ChoosePromptTarget = (
  params: DecisionChooseParams,
  progress: Progress,
) => Promise<DecisionChooseResult>;

/** Resolve one terminal prompt without executing an action or retaining capture state. */
export async function resolvePromptLocator(
  page: Page,
  chain: LocatorChain,
  operation: ApcLocatorOperation,
  choose: ChoosePromptTarget,
  progress: Progress,
): Promise<ChainTarget | null> {
  progress.throwIfStopped();
  const terminal = chain.steps.at(-1);
  if (terminal?.selector.type !== "prompt") {
    throw new UnsupportedPromptLocatorError(
      "Prompt resolution requires a terminal prompt selector",
    );
  }
  const prefix = chain.steps.slice(0, -1);
  if (prefix.some((step) => step.selector.type === "prompt")) {
    throw new UnsupportedPromptLocatorError("Intermediate prompt selectors are not supported");
  }
  if (terminal.nth !== undefined) {
    throw new UnsupportedPromptLocatorError(
      "Positional modifiers on prompt results are not supported",
    );
  }
  const action = actionForLocatorOperation(operation);
  if (action === undefined) {
    throw new UnsupportedPromptLocatorError(`Prompt selectors do not support ${operation}()`);
  }
  if (!prefix.length && terminal.type === "frame") {
    throw new UnsupportedPromptLocatorError("A frame step requires a preceding iframe query");
  }

  const request: PromptRequest = {
    prompt: terminal.selector.value,
    action,
    operation,
    prefix,
    frameStep: terminal.type === "frame",
  };
  const target = await captureAndChoose(page, request, choose, progress);
  if (target) return target;
  // Content can render after the first capture (late iframes, client-side forms). A miss
  // costs one settle wait and one more capture; a hit costs nothing extra.
  await progress.run("waiting for the page to settle before re-capture", () =>
    waitForDomNetworkQuiet(page.mainFrame(), page.logger, RECAPTURE_SETTLE_TIMEOUT_MS, progress),
  );
  progress.throwIfStopped();
  return captureAndChoose(page, request, choose, progress);
}

type PromptRequest = {
  prompt: string;
  action: ApcAction;
  operation: ApcLocatorOperation;
  prefix: LocatorChain["steps"];
  frameStep: boolean;
};

/** Each attempt resolves its own scope, so a re-capture never uses nodes a page update replaced. */
async function captureAndChoose(
  page: Page,
  request: PromptRequest,
  choose: ChoosePromptTarget,
  progress: Progress,
): Promise<ChainTarget | null> {
  const { prompt, action, operation, prefix, frameStep } = request;
  let scopes: ApcScope[] | undefined;
  if (prefix.length) {
    const targets = await progress.run("resolving prompt locator scope", () =>
      resolveLocatorChain(page, page.mainFrame(), { steps: prefix }, progress),
    );
    if (!targets.length) return null;
    scopes = [];
    for (const target of targets) {
      const { node } = await progress.run("describing prompt locator scope", () =>
        target.frame.session.send<Protocol.DOM.DescribeNodeResponse>("DOM.describeNode", {
          backendNodeId: target.backendNodeId,
        }),
      );
      const isFrame = /^(iframe|frame)$/i.test(node.localName || node.nodeName);
      if (frameStep && !isFrame) {
        throw new UnsupportedPromptLocatorError("A frame step requires an iframe or frame element");
      }
      scopes.push(isFrame ? { type: "frame", target } : { type: "element", target });
    }
  }

  const capture = await progress.run("preparing prompt locator candidates", () =>
    page.queryAnnotatedPageContentCandidates(
      { operation, ...(scopes ? { scopes } : {}) },
      progress,
    ),
  );
  if (!capture.candidates.length) return null;
  const params: DecisionChooseParams = {
    prompt,
    action,
    candidates: capture.candidates.map(({ id, description }) => ({ id, description })),
  };
  // Snapshot membership and target identity before calling application code.
  const resultSchema = createDecisionChooseResultSchema(params);
  const targetsById = new Map<string, ChainTarget>();
  for (const candidate of capture.candidates) {
    const target = capture.targetsById.get(candidate.id);
    if (target)
      targetsById.set(candidate.id, { frame: target.frame, backendNodeId: target.backendNodeId });
  }
  const result = await progress.run("selecting a prompt locator target", () =>
    choose(params, progress),
  );
  progress.throwIfStopped();
  const parsed = resultSchema.safeParse(result);
  if (!parsed.success) throw new InvalidPromptLocatorSelectionError();
  if (parsed.data.status === "no_match") return null;
  if (parsed.data.status === "refused") throw new PromptLocatorRefusedError();
  const target = targetsById.get(parsed.data.id);
  if (!target) throw new InvalidPromptLocatorSelectionError();
  return target;
}
