/** Log level a raw SDK event should be recorded at. */
export type HarnessEventLogLevel = 0 | 1 | 2;

export interface HarnessEventClassification {
  /** The event reports a failure the operator should see without debug output. */
  isError?: boolean;
  /**
   * The event carries complete content of its own (a finished message, a tool
   * result, usage). Lifecycle boundary events without content are dropped.
   */
  hasContent?: boolean;
}

/**
 * Stream fragments — deltas, partial updates, chunks — that only accumulate
 * into a later completed event and never carry standalone content.
 */
export function isStreamDeltaEventType(type: string): boolean {
  return (
    type === "stream_event" || /(?:^|[-_.:])(?:delta|update|updated|partial|chunk)$/iu.test(type)
  );
}

/** Lifecycle markers (`*-start`, `*.started`, `*_end`, ...) that bracket other events. */
export function isLifecycleBoundaryEventType(type: string): boolean {
  return /(?:^|[-_.:])(?:start|started|begin|end|ended|stop|stopped)$/iu.test(type);
}

/**
 * Decide how a raw SDK event lands in the harness log. The readable per-step
 * trace is emitted from the normalized trajectory after the run, so raw events
 * are debug material: errors stay visible at level 1, pure stream noise is
 * dropped (`undefined`), and everything else is kept at level 2.
 */
export function harnessEventLogLevel(
  type: string,
  classification: HarnessEventClassification = {},
): HarnessEventLogLevel | undefined {
  if (classification.isError) return 1;
  if (isStreamDeltaEventType(type)) return undefined;
  if (isLifecycleBoundaryEventType(type) && !classification.hasContent) return undefined;
  return 2;
}
