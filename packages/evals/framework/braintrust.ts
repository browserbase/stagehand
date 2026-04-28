let braintrustPromise: Promise<typeof import("braintrust")> | undefined;

export function loadBraintrust(): Promise<typeof import("braintrust")> {
  braintrustPromise ??= import("braintrust");
  return braintrustPromise;
}

export async function tracedSpan<T>(
  fn: () => Promise<T>,
  options: { name: string },
): Promise<T> {
  const { traced } = await loadBraintrust();
  return traced(fn, options);
}
