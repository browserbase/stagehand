// Account for every billed request before falling back or returning usage.
export async function settleAll<T extends readonly unknown[]>(pending: T) {
  try {
    return await Promise.all(pending);
  } catch (error) {
    await Promise.allSettled(pending);
    throw error;
  }
}
