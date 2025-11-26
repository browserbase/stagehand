/**
 * Determine the current environment in which the evaluations are running:
 * - BROWSERBASE or LOCAL
 *
 * The environment is read from the EVAL_ENV environment variable.
 */
export const env: "BROWSERBASE" | "LOCAL" =
  process.env.EVAL_ENV?.toLowerCase() === "browserbase"
    ? "BROWSERBASE"
    : "LOCAL";

/**
 * Custom OpenAI-compatible endpoint configuration (e.g., for vLLM)
 *
 * Set these environment variables to use a custom inference endpoint:
 * - CUSTOM_OPENAI_BASE_URL: The base URL for the custom endpoint (e.g., "http://localhost:8000/v1")
 * - CUSTOM_OPENAI_API_KEY: Optional API key (defaults to "EMPTY" for vLLM)
 * - CUSTOM_OPENAI_MODEL_NAME: The model name to use with the custom endpoint
 */
export const customOpenAIConfig = {
  baseURL: process.env.CUSTOM_OPENAI_BASE_URL,
  apiKey: process.env.CUSTOM_OPENAI_API_KEY || "EMPTY",
  modelName: process.env.CUSTOM_OPENAI_MODEL_NAME,
};
