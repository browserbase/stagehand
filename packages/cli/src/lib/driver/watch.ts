export interface WatchAttempt {
  matched: boolean;
  value?: string;
}

export interface WatchResult {
  attempts: number;
  elapsedMs: number;
  value?: string;
}

export interface PollWatchOptions {
  check: () => Promise<WatchAttempt>;
  intervalMs: number;
  timeoutMs: number;
}

export async function pollWatch(
  options: PollWatchOptions,
): Promise<WatchResult> {
  const start = Date.now();
  let attempts = 0;

  while (true) {
    attempts += 1;
    const attempt = await options.check();
    if (attempt.matched) {
      return {
        attempts,
        elapsedMs: Date.now() - start,
        value: attempt.value,
      };
    }

    if (Date.now() - start >= options.timeoutMs) {
      throw new Error(
        `Watch condition not met within ${options.timeoutMs}ms after ${attempts} checks.`,
      );
    }

    await sleep(options.intervalMs);
  }
}

export function createStringMatcher(
  query: string,
  regex: boolean,
): (value: string) => boolean {
  if (!regex) {
    return (value: string) => value.includes(query);
  }

  const re = new RegExp(query);
  return (value: string) => re.test(value);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
