export type UnderstudyServiceMode = "local" | "remote";
export type BrowserServiceMode = "local" | "remote-cdp" | "browserbase";
export type LLMServiceMode = "aisdk" | "custom";

export interface V4ServiceConfig {
  understudyMode: UnderstudyServiceMode;
  understudyRemoteUrl?: string;
  browserMode: BrowserServiceMode;
  llmMode: LLMServiceMode;
}

function normalizeBrowserMode(raw: string): BrowserServiceMode {
  const value = raw.toLowerCase();
  if (value === "browserbase" || value === "bb") {
    return "browserbase";
  }
  if (value === "remote" || value === "remote-cdp" || value === "cdp") {
    return "remote-cdp";
  }
  return "local";
}

function normalizeLLMMode(raw: string): LLMServiceMode {
  const value = raw.toLowerCase();
  if (value === "custom") {
    return "custom";
  }
  return "aisdk";
}

export function resolveV4ServiceConfig(): V4ServiceConfig {
  const rawUnderstudyMode = (process.env.V4_UNDERSTUDY_MODE ?? "local").toLowerCase();
  const understudyMode: UnderstudyServiceMode =
    rawUnderstudyMode === "remote" ? "remote" : "local";

  return {
    understudyMode,
    understudyRemoteUrl: process.env.V4_UNDERSTUDY_REMOTE_URL,
    browserMode: normalizeBrowserMode(process.env.V4_BROWSER_MODE ?? "local"),
    llmMode: normalizeLLMMode(process.env.V4_LLM_MODE ?? "aisdk"),
  };
}
