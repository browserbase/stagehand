/**
 * Estimates tokens in a string based on character count
 * @param text The text to count tokens for
 * @returns Estimated number of tokens
 */
export function countTokens(text: string): number {
  // Rough estimation: ~4 characters per token (including spaces)

  return Math.ceil(text.length / 4);
}
