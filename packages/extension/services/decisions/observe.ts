import type { Variables } from "@browserbasehq/stagehand-protocol/types";
import type { StagehandLogger } from "../../logger.js";
import type { Page } from "../../understudy/page.js";
import type { HybridSnapshot } from "../../types/private/snapshot.js";
import type { Progress } from "../../understudy/progress.js";
import { settleAll } from "./concurrency.js";
import { parseOutline } from "./outline.js";
import { readFacts } from "./actionFacts.js";
import type { DecisionsConfig } from "./config.js";
import {
  observationSignature,
  observationView,
  type ObservationSnapshot,
} from "./observeCandidates.js";
import {
  classifyObservation,
  selectObservation,
  type ObservationOutcome,
} from "./observeSelection.js";
import { redactor } from "./args.js";

type ObserveDeps = {
  page: Pick<Page, "captureSnapshot" | "evaluate" | "url"> & Partial<Pick<Page, "frameForId">>;
  logger: StagehandLogger;
  instruction?: string;
  variables?: Variables;
  systemPrompt?: string;
  snapshotOptions: Parameters<Page["captureSnapshot"]>[0];
  progress: Progress;
};
export async function runDecisionsObserve(
  config: DecisionsConfig,
  deps: ObserveDeps,
): Promise<ObservationOutcome & { inferenceTimeMs: number }> {
  let inferenceTimeMs = 0;
  const snapshot = async (captured?: HybridSnapshot): Promise<ObservationSnapshot> => {
    const snap = captured ?? (await deps.page.captureSnapshot(deps.snapshotOptions, deps.progress));
    // Only outline nodes and editable side-channel nodes can enter observationView.
    // Reading the entire DOM map is costly on pages with thousands of hidden nodes.
    const ids = new Set([
      ...parseOutline(snap.combinedTree).map((node) => node.id),
      ...(snap.combinedEditableIds ?? []),
    ]);
    const pathsFor = (map: Record<string, string>) =>
      Object.fromEntries([...ids].flatMap((id) => (map[id] ? [[id, map[id]!]] : [])));
    const facts = await deps.progress.run("reading observation evidence", async () => {
      const page = deps.page;
      if (!snap.perFrame?.length || !page.frameForId)
        return deps.page.evaluate(readFacts, pathsFor(snap.combinedXpathMap));
      const frameForId = page.frameForId.bind(page);
      // Combined paths cross iframe boundaries. Read each frame's relative paths in its own world.
      const frames = await settleAll(
        snap.perFrame.map(async (frame) => {
          const paths = pathsFor(frame.xpathMap);
          if (!Object.keys(paths).length) return {};
          try {
            return await frameForId(frame.frameId).evaluate(readFacts, paths);
          } catch {
            deps.progress.throwIfStopped();
            // Missing control evidence still makes observationView fall back. An unrelated
            // detached frame with no candidate controls must not invalidate the main frame.
            return {};
          }
        }),
      );
      return Object.assign({}, ...frames);
    });
    return {
      formattedTree: snap.combinedTree,
      xpathMap: snap.combinedXpathMap,
      urlMap: snap.combinedUrlMap,
      facts,
      editableIds: snap.combinedEditableIds ?? [],
      url: deps.page.url(),
    };
  };
  try {
    // Custom instructions retain their full ordinary-observe interpretation until separately evaluated.
    if (deps.systemPrompt)
      return { kind: "fallback", reason: "custom_instructions", inferenceTimeMs };
    const started = performance.now();
    const decisionConfig = {
      ...config,
      signal: config.signal
        ? AbortSignal.any([config.signal, deps.progress.signal])
        : deps.progress.signal,
    };
    // Instruction-only intent can run while the browser captures the candidate evidence.
    const [captured, intent] = await deps.progress.run("preparing observation decisions", () =>
      settleAll([
        deps.page.captureSnapshot(deps.snapshotOptions, deps.progress),
        deps.instruction?.trim()
          ? classifyObservation(decisionConfig, deps.instruction, deps.variables)
          : Promise.resolve(undefined),
      ] as const),
    );
    deps.progress.throwIfStopped();
    if (intent?.kind === "fallback")
      return { ...intent, inferenceTimeMs: Math.round(performance.now() - started) };
    const before = await snapshot(captured);
    let outcome: ObservationOutcome;
    try {
      outcome = await deps.progress.run("waiting for observation decisions", () =>
        selectObservation(decisionConfig, before, deps.instruction, deps.variables, intent),
      );
    } finally {
      inferenceTimeMs = Math.round(performance.now() - started);
    }
    deps.progress.throwIfStopped();
    if (outcome.kind === "done") {
      const after = await snapshot();
      // Checking the whole candidate universe also detects added matches and invalidated empty results.
      if (
        observationSignature(observationView(before)) !==
        observationSignature(observationView(after))
      )
        return { kind: "fallback", reason: "observation_evidence_changed", inferenceTimeMs };
    }
    return { ...outcome, inferenceTimeMs };
  } catch (error) {
    deps.progress.throwIfStopped();
    const reason = (redactor(deps.variables) ?? ((text: string) => text))(
      error instanceof Error ? error.message : String(error),
    );
    return { kind: "fallback", reason: `decision_error:${reason}`, inferenceTimeMs };
  } finally {
    deps.logger.debug("Decisions observe completed", { category: "decisions", inferenceTimeMs });
  }
}
