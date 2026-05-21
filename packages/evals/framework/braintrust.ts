let braintrustPromise: Promise<typeof import("braintrust")> | undefined;

export function hasBraintrustApiKey(): boolean {
  return Boolean(process.env.BRAINTRUST_API_KEY);
}

export function loadBraintrust(): Promise<typeof import("braintrust")> {
  braintrustPromise ??= import("braintrust");
  return braintrustPromise;
}

export async function tracedSpan<T>(
  fn: () => Promise<T>,
  options: { name: string },
): Promise<T> {
  if (!hasBraintrustApiKey()) {
    return fn();
  }
  const { traced } = await loadBraintrust();
  return traced(fn, options);
}
