/**
 * Shared bare-loop tuning knobs. The 2026-07-09 3-provider Modal sandbox
 * smoke found 20 steps was cap-binding for webtailbench-style tasks with a
 * single generic browse tool (no batched/high-level actions), so the
 * bare-loop default here is roughly double that. Configurable per harness
 * via its own env var so a slow/expensive model can be capped tighter.
 */
export const DEFAULT_BARE_LOOP_MAX_STEPS = 40;

export function readBareLoopMaxSteps(envVar: string): number {
  const raw = process.env[envVar];
  if (!raw) return DEFAULT_BARE_LOOP_MAX_STEPS;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0
    ? parsed
    : DEFAULT_BARE_LOOP_MAX_STEPS;
}
