import { Anthropic } from "@anthropic-ai/sdk";

/**
 * Counts tokens in a string using Anthropic's API
 * @param text The text to count tokens for
 * @returns Number of tokens
 */
export async function countTokens(text: string): Promise<number> {
  try {
    const client = new Anthropic();

    const response = await client.messages.countTokens({
      model: "claude-sonnet-4-20250514",
      messages: [
        {
          role: "user",
          content: text,
        },
      ],
    });

    return response.input_tokens;
  } catch (error) {
    console.error("Error counting tokens:", error);
    const words = text.split(/\s+/).filter((w) => w.length > 0);
    return Math.ceil(words.length / 4);
  }
}
