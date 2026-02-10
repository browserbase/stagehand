/**
 * Stagehand shutdown helpers for internal state and resources.
 *
 * This module handles Stagehand-owned resources (CDP context, loggers,
 * in-memory state). It does not kill browsers or end Browserbase sessions.
 */

/**
 * Best-effort shutdown of Stagehand-managed resources.
 */
export async function shutdownStagehandResources(opts: {
  closeSessionLogger?: () => Promise<void>;
  unhookTransport?: () => void;
  closeContext?: () => Promise<void>;
}): Promise<void> {
  try {
    await opts.closeSessionLogger?.();
  } catch {
    // ignore logger close errors
  }

  try {
    opts.unhookTransport?.();
  } catch {
    //
  }

  try {
    await opts.closeContext?.();
  } catch {
    //
  }
}

/**
 * Best-effort finalization of Stagehand state after shutdown attempts.
 */
export function finalizeStagehandShutdown(opts: {
  resetState?: () => void;
  clearContext?: () => void;
  clearClosing?: () => void;
  resetMetadata?: () => void;
  unbindLogger?: () => void;
  clearBus?: () => void;
  clearHistory?: () => void;
  clearHandlers?: () => void;
  removeInstance?: () => void;
}): void {
  try {
    opts.resetState?.();
  } catch {
    //
  }
  try {
    opts.clearContext?.();
  } catch {
    //
  }
  try {
    opts.clearClosing?.();
  } catch {
    //
  }
  try {
    opts.resetMetadata?.();
  } catch {
    //
  }
  try {
    opts.unbindLogger?.();
  } catch {
    // ignore
  }
  try {
    opts.clearBus?.();
  } catch {
    // ignore
  }
  try {
    opts.clearHistory?.();
  } catch {
    //
  }
  try {
    opts.clearHandlers?.();
  } catch {
    //
  }
  try {
    opts.removeInstance?.();
  } catch {
    //
  }
}
