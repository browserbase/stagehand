import Browserbase from "@browserbasehq/sdk";

export interface BrowserbaseWebToolConfig {
  apiKey?: string;
  baseUrl?: string;
  maxRetries?: number;
  timeoutMs?: number;
}

export function createBrowserbaseWebClient(config: BrowserbaseWebToolConfig): Browserbase {
  const apiKey = config.apiKey ?? process.env.BROWSERBASE_API_KEY;
  if (typeof apiKey !== "string" || apiKey.trim().length === 0) {
    throw new TypeError(
      "Browserbase web tools require apiKey or the BROWSERBASE_API_KEY environment variable.",
    );
  }
  if (
    config.maxRetries !== undefined &&
    (!Number.isInteger(config.maxRetries) || config.maxRetries < 0)
  ) {
    throw new TypeError("Browserbase web tool maxRetries must be a non-negative integer.");
  }
  if (
    config.timeoutMs !== undefined &&
    (!Number.isFinite(config.timeoutMs) || config.timeoutMs <= 0)
  ) {
    throw new TypeError("Browserbase web tool timeoutMs must be a positive number.");
  }

  return new Browserbase({
    apiKey,
    ...(config.baseUrl ? { baseURL: config.baseUrl.replace(/\/+$/u, "") } : {}),
    ...(config.maxRetries === undefined ? {} : { maxRetries: config.maxRetries }),
    ...(config.timeoutMs === undefined ? {} : { timeout: config.timeoutMs }),
  });
}
