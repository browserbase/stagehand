/**
 * Zero-LLM screenshot selection from trajectory signals ("find the needle"). Each screenshot is
 * scored from what its step DID and what the text evidence already established:
 *   - answer anchors located at the step (the frame is visual proof of a claimed value)
 *   - state-changing actions (fill / click / select / submit): the post-action frame shows the state
 *   - page transitions: first and last frame on each distinct URL
 *   - text-poor steps: the screenshot is the only record of what happened
 *   - criterion text-retrieval hits at the step
 * Near-duplicates (same URL, adjacent step, lower score) are dropped; the top K are returned in
 * chronological order. Final-state frames are attached separately and always.
 */
import type { Trajectory } from "./types.js";

export interface ImageCandidate {
  canonicalIndex: number;
  originalStepIndex: number;
}

export interface SignalInputs {
  trajectory: Trajectory;
  images: ImageCandidate[];
  anchorSteps: number[];
  retrievalSteps: number[];
  k: number;
}

const MUTATION =
  /\.(fill|type|click|dblclick|check|uncheck|selectOption|press|setInputFiles|tap)\(|\b(fill|type|click|select|submit|press|check|add[_ -]?to[_ -]?cart|checkout|book|reserve)\b/i;

function stepText(step: Trajectory["steps"][number] | undefined): string {
  if (!step) return "";
  const out = step.toolOutput?.result;
  return typeof out === "string" ? out : out == null ? "" : JSON.stringify(out);
}

function stepUrl(step: Trajectory["steps"][number] | undefined): string | undefined {
  return step?.probeEvidence?.url ?? undefined;
}

export function scoreImages(
  inputs: SignalInputs,
): Array<ImageCandidate & { score: number; reasons: string[] }> {
  const { trajectory, images } = inputs;
  const anchors = new Set(inputs.anchorSteps);
  const retrieved = new Set(inputs.retrievalSteps);
  // first/last image step per URL
  const byUrl = new Map<string, number[]>();
  for (const img of images) {
    const url = stepUrl(trajectory.steps[img.originalStepIndex]) ?? `#${img.originalStepIndex}`;
    const list = byUrl.get(url) ?? [];
    list.push(img.originalStepIndex);
    byUrl.set(url, list);
  }
  const firstOnUrl = new Set<number>();
  const lastOnUrl = new Set<number>();
  for (const steps of byUrl.values()) {
    firstOnUrl.add(Math.min(...steps));
    lastOnUrl.add(Math.max(...steps));
  }
  const n = trajectory.steps.length;
  return images.map((img) => {
    const s = img.originalStepIndex;
    const step = trajectory.steps[s];
    const reasons: string[] = [];
    let score = 0;
    if (anchors.has(s) || anchors.has(s - 1)) ((score += 3), reasons.push("anchor"));
    const args = JSON.stringify(step?.actionArgs ?? {});
    if (MUTATION.test(`${step?.actionName ?? ""} ${args}`))
      ((score += 2), reasons.push("state-change"));
    if (firstOnUrl.has(s)) ((score += 1.5), reasons.push("new-page"));
    if (lastOnUrl.has(s)) ((score += 1), reasons.push("last-on-page"));
    const text = stepText(step);
    if (text.length < 200 || /screenshot captured/i.test(text))
      ((score += 1.5), reasons.push("text-poor"));
    if (retrieved.has(s)) ((score += 1), reasons.push("criterion-hit"));
    score += n > 0 ? (s / n) * 0.5 : 0; // mild recency tie-break
    return { ...img, score, reasons };
  });
}

export function selectSignalImages(inputs: SignalInputs): number[] {
  const scored = scoreImages(inputs).sort(
    (a, b) => b.score - a.score || b.originalStepIndex - a.originalStepIndex,
  );
  const picked: typeof scored = [];
  for (const c of scored) {
    if (picked.length >= inputs.k) break;
    const url = stepUrl(inputs.trajectory.steps[c.originalStepIndex]);
    const nearDup = picked.some(
      (p) =>
        Math.abs(p.originalStepIndex - c.originalStepIndex) <= 1 &&
        stepUrl(inputs.trajectory.steps[p.originalStepIndex]) === url &&
        !c.reasons.includes("anchor"),
    );
    if (!nearDup) picked.push(c);
  }
  return picked
    .sort((a, b) => a.originalStepIndex - b.originalStepIndex)
    .map((c) => c.canonicalIndex);
}
