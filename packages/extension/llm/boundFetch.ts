/**
 * `fetch` captured at module load. Credentialed requests use this instead of the
 * ambient `globalThis.fetch`, so later reassignment of the global cannot observe
 * their headers.
 */
export const boundFetch: typeof globalThis.fetch = globalThis.fetch.bind(globalThis);
