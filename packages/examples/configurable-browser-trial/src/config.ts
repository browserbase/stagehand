import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "yaml";
import pc from "picocolors";
import { ManifestSchema, type Manifest, type Features } from "./types.js";

/** Resolve which model API key env var to use for a given "provider/model" id. */
export function resolveModelKey(model: string): { key: string; envVar: string } | null {
  const provider = model.split("/")[0];
  const map: Record<string, string> = {
    anthropic: "ANTHROPIC_API_KEY",
    openai: "OPENAI_API_KEY",
    google: "GOOGLE_GENERATIVE_AI_API_KEY",
    gemini: "GOOGLE_GENERATIVE_AI_API_KEY",
  };
  const envVar = map[provider];
  if (envVar && process.env[envVar]) return { key: process.env[envVar]!, envVar };
  if (process.env.STAGEHAND_MODEL_API_KEY)
    return { key: process.env.STAGEHAND_MODEL_API_KEY, envVar: "STAGEHAND_MODEL_API_KEY" };
  return null;
}

/** Load + validate the trial manifest. Exits with a friendly message on error. */
export function loadManifest(path: string): Manifest {
  const abs = resolve(process.cwd(), path);
  let raw: string;
  try {
    raw = readFileSync(abs, "utf8");
  } catch {
    console.error(pc.red(`✖ Could not read manifest at ${abs}`));
    console.error(pc.dim(`  Run ${pc.cyan("bbpoc init")} to scaffold one.`));
    process.exit(1);
  }
  let data: unknown;
  try {
    data = parse(raw);
  } catch (e) {
    console.error(pc.red(`✖ ${path} is not valid YAML:`), (e as Error).message);
    process.exit(1);
  }
  const parsed = ManifestSchema.safeParse(data);
  if (!parsed.success) {
    console.error(pc.red(`✖ ${path} has invalid fields:`));
    for (const issue of parsed.error.issues) {
      console.error(pc.dim(`  • ${issue.path.join(".") || "(root)"}: ${issue.message}`));
    }
    process.exit(1);
  }
  return parsed.data;
}

/** Verify the required env is present before we spend money on sessions. */
export function checkEnv(model: string): void {
  const missing: string[] = [];
  if (!process.env.BROWSERBASE_API_KEY) missing.push("BROWSERBASE_API_KEY");
  if (!process.env.BROWSERBASE_PROJECT_ID) missing.push("BROWSERBASE_PROJECT_ID");
  if (missing.length) {
    console.error(pc.red(`✖ Missing required env: ${missing.join(", ")}`));
    console.error(pc.dim("  Copy .env.example → .env and fill it in."));
    process.exit(1);
  }
  if (!resolveModelKey(model)) {
    console.error(pc.red(`✖ No model API key found for "${model}".`));
    console.error(
      pc.dim("  Set ANTHROPIC_API_KEY (default), OPENAI_API_KEY, or GOOGLE_GENERATIVE_AI_API_KEY."),
    );
    process.exit(1);
  }
}

/** Merge manifest defaults with per-site feature overrides. */
export function effectiveFeatures(base: Features, override?: Partial<Features>): Features {
  return { ...base, ...(override ?? {}) };
}

/** Apply a named preset to the parsed manifest (CLI sugar like `--preset verified`). */
export function applyPreset(manifest: Manifest, preset?: string): Manifest {
  if (!preset) return manifest;
  const presets: Record<string, Partial<Features>> = {
    // Full advanced-stealth posture — the canonical enterprise trial.
    verified: { advancedStealth: true, proxies: true, solveCaptchas: true },
    // Baseline cloud browser, no stealth — useful as an A/B control.
    baseline: { advancedStealth: false, proxies: false, solveCaptchas: false },
    // Stealth without proxies (rare, but customers ask).
    "stealth-only": { advancedStealth: true, proxies: false },
  };
  const p = presets[preset];
  if (!p) {
    console.error(
      pc.red(`✖ Unknown preset "${preset}". Options: ${Object.keys(presets).join(", ")}`),
    );
    process.exit(1);
  }
  manifest.defaults.features = { ...manifest.defaults.features, ...p };
  return manifest;
}
