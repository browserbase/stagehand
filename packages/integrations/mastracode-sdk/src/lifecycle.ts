/**
 * Driver lifecycle guards that mastracode itself does not provide: a deadline
 * on startup (mastracode's MCP client waits up to 7 days on connect and
 * listTools, and runMC's timeout only starts after startup) and detection of a
 * dead parent (the driver runs detached with stdin closed, so nothing else
 * tells it the evals process is gone).
 */

export const MASTRACODE_DEFAULT_STARTUP_TIMEOUT_MS = 120_000;

export class StartupTimeoutError extends Error {
  constructor(
    readonly phase: string,
    readonly timeoutMs: number,
  ) {
    super(`mastracode startup timed out after ${timeoutMs} ms (${phase})`);
    this.name = "StartupTimeoutError";
  }
}

/**
 * Tracks one startup budget across several phases: each `run` gets the time
 * left, and rejects with StartupTimeoutError naming the phase that overran.
 */
export function createStartupDeadline(timeoutMs: number, now: () => number = Date.now) {
  const deadline = now() + timeoutMs;
  return async function run<T>(phase: string, work: Promise<T>): Promise<T> {
    const remaining = deadline - now();
    if (remaining <= 0) {
      work.catch(() => undefined);
      throw new StartupTimeoutError(phase, timeoutMs);
    }
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        work,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new StartupTimeoutError(phase, timeoutMs)), remaining);
          timer.unref?.();
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
}

export interface ParentWatchOptions {
  /** The parent pid at driver start. */
  originalPpid: number;
  onGone: () => void;
  intervalMs?: number;
  getPpid?: () => number;
  /** `process.kill(pid, 0)`: throws once the pid no longer exists. */
  probe?: (pid: number) => void;
}

/**
 * Poll for the parent's death: the driver is reparented (ppid changes, to 1
 * or a subreaper) or the original pid stops existing. Fires `onGone` once.
 * Returns a stop function. The timer is unref'd so it never holds the driver open.
 */
export function watchParent(options: ParentWatchOptions): () => void {
  const getPpid = options.getPpid ?? (() => process.ppid);
  const probe = options.probe ?? ((pid: number) => process.kill(pid, 0));
  let fired = false;
  const check = (): void => {
    if (fired) return;
    let gone = getPpid() !== options.originalPpid;
    if (!gone) {
      try {
        probe(options.originalPpid);
      } catch (error) {
        // EPERM means the pid exists but belongs to someone else: not gone.
        gone = (error as NodeJS.ErrnoException)?.code !== "EPERM";
      }
    }
    if (gone) {
      fired = true;
      clearInterval(timer);
      options.onGone();
    }
  };
  const timer = setInterval(check, options.intervalMs ?? 2_000);
  timer.unref?.();
  return () => clearInterval(timer);
}
