import { cyan, dim, yellow } from "./format.js";
import { getEvalsEnvReport } from "../evalsEnv.js";

export type KeyState = "set" | "missing";
export type KeySource = "process-env" | "package-dotenv" | "cwd-dotenv" | "none";

export type ProviderKeyEntry = {
  state: KeyState;
  source: KeySource;
};

export type GoogleKeyEntry = ProviderKeyEntry & {
  var: "GOOGLE_GENERATIVE_AI_API_KEY" | "GEMINI_API_KEY" | null;
};

export type LangSmithKeyEntry = ProviderKeyEntry & {
  var: "LANGSMITH_API_KEY" | "LANGCHAIN_API_KEY" | null;
};

export type BrowserbaseKeyEntry = {
  apiKey: KeyState;
  projectId: KeyState;
  viaAlias: boolean;
};

export type EnvSnapshot = {
  openai: ProviderKeyEntry;
  anthropic: ProviderKeyEntry;
  google: GoogleKeyEntry;
  browserbase: BrowserbaseKeyEntry;
  braintrust: ProviderKeyEntry;
  langsmith: LangSmithKeyEntry;
};

export function resolveKey(name: string): { value: string; source: KeySource } {
  const fromProcess = process.env[name];
  if (fromProcess && fromProcess.length > 0) {
    const fileKind = getEvalsEnvReport()?.sources.get(name);
    const source: KeySource =
      fileKind === "package" ? "package-dotenv" : fileKind === "cwd" ? "cwd-dotenv" : "process-env";
    return { value: fromProcess, source };
  }
  return { value: "", source: "none" };
}

function providerEntry(name: string): ProviderKeyEntry {
  const r = resolveKey(name);
  return {
    state: r.value ? "set" : "missing",
    source: r.source,
  };
}

function langSmithEntry(): LangSmithKeyEntry {
  const primary = providerEntry("LANGSMITH_API_KEY");
  if (primary.state === "set") return { ...primary, var: "LANGSMITH_API_KEY" };
  const fallback = providerEntry("LANGCHAIN_API_KEY");
  return {
    ...fallback,
    var: fallback.state === "set" ? "LANGCHAIN_API_KEY" : null,
  };
}

function googleEntry(): GoogleKeyEntry {
  const a = resolveKey("GOOGLE_GENERATIVE_AI_API_KEY");
  if (a.value) {
    return {
      state: "set",
      source: a.source,
      var: "GOOGLE_GENERATIVE_AI_API_KEY",
    };
  }
  const b = resolveKey("GEMINI_API_KEY");
  if (b.value) {
    return { state: "set", source: b.source, var: "GEMINI_API_KEY" };
  }
  return { state: "missing", source: "none", var: null };
}

function browserbaseEntry(): BrowserbaseKeyEntry {
  const canonApi = resolveKey("BROWSERBASE_API_KEY");
  const canonProj = resolveKey("BROWSERBASE_PROJECT_ID");
  const aliasApi = resolveKey("BB_API_KEY");
  const aliasProj = resolveKey("BB_PROJECT_ID");

  const canonApiPresent = canonApi.value.length > 0;
  const aliasApiPresent = aliasApi.value.length > 0;
  const canonProjPresent = canonProj.value.length > 0;
  const aliasProjPresent = aliasProj.value.length > 0;

  const apiSet = canonApiPresent || aliasApiPresent;
  const projSet = canonProjPresent || aliasProjPresent;

  const apiAbsent = !apiSet;
  const projAbsent = !projSet;
  const apiOnlyAlias = aliasApiPresent && !canonApiPresent;
  const projOnlyAlias = aliasProjPresent && !canonProjPresent;
  const anyPresent = !apiAbsent || !projAbsent;
  const allPresentAreAlias = (apiAbsent || apiOnlyAlias) && (projAbsent || projOnlyAlias);
  const viaAlias = anyPresent && allPresentAreAlias;

  return {
    apiKey: apiSet ? "set" : "missing",
    projectId: projSet ? "set" : "missing",
    viaAlias,
  };
}

export function snapshotEnv(): EnvSnapshot {
  return {
    openai: providerEntry("OPENAI_API_KEY"),
    anthropic: providerEntry("ANTHROPIC_API_KEY"),
    google: googleEntry(),
    browserbase: browserbaseEntry(),
    braintrust: providerEntry("BRAINTRUST_API_KEY"),
    langsmith: langSmithEntry(),
  };
}

export function hasZeroProviderKeys(s: EnvSnapshot): boolean {
  return (
    s.openai.state === "missing" && s.anthropic.state === "missing" && s.google.state === "missing"
  );
}

export function renderInlineWarning(s: EnvSnapshot): string | null {
  if (!hasZeroProviderKeys(s)) return null;
  return `  ${yellow("⚠ No provider API key found.")} ${dim("Run")} ${cyan("evals doctor")} ${dim("for setup help.")}`;
}
