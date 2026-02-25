export const DEFAULT_TOOL_TIMEOUT_MS = 45_000;

export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  toolName: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new Error(
          `${toolName} tool call timed out after ${timeoutMs}ms - try adjusting the prompt, or using a different tool`,
        ),
      );
    }, timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}
