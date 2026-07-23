/**
 * Shared bare-loop tuning knobs. The default step cap keeps bare loops
 * bounded while leaving headroom for tasks that need many single-command
 * browse steps. Each harness reads its own env var override, so a slow or
 * expensive model can be capped tighter without affecting the others.
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
