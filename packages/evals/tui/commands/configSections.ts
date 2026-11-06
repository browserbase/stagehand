/**
 * `evals config harnesses|providers|verifier|campaign …`
 *
 *   config harnesses                               print the section
 *   config harnesses set <h> models a,b            → harnesses.<h>.models (EVAL_<H>_MODELS default)
 *   config harnesses set <h> tool <surface>        → harnesses.<h>.tool (--tool default; validated)
 *   config harnesses set <h> nodeOptions "<flags>" → harnesses.<h>.nodeOptions (doctor advisory)
 *   config harnesses reset <h>
 *   config providers set <p> concurrency <n>       → providers.<p>.concurrency
 *   config providers reset <p>
 *   config verifier set model <id> | maxUnverifiableCriteria <n>
 *   config verifier reset
 *   config campaign set tag <value> | reset
 *
 * Mirrors `config tracing`: every key has an env twin and the env always wins.
 * Writes go to evals.config.local.json unless `--shared` was passed.
 */

import { bold, cyan, dim, gray, green, red } from "../format.js";
import {
  readConfig,
  scopeSuffix,
  updateConfig,
  type ConfigFile,
  type ConfigScope,
  type HarnessConfigSection,
  type ProviderConfigSection,
} from "./config.js";
import {
  getBenchHarness,
  isBenchHarness,
  listBenchHarnesses,
} from "../../framework/benchHarness.js";
import { PROVIDER_CONCURRENCY_ENV } from "../../framework/providerConcurrency.js";
import { VERIFIER_MODEL_ENV } from "../../framework/verifierModel.js";

export type ConfigSectionName = "harnesses" | "providers" | "verifier" | "campaign";

const HARNESS_KEYS = ["models", "tool", "nodeOptions"] as const;
const PROVIDER_KEYS = ["concurrency"] as const;
const VERIFIER_KEYS = ["model", "maxUnverifiableCriteria"] as const;
const CAMPAIGN_KEYS = ["tag"] as const;

function fail(message: string, hint?: string): void {
  console.error(red(`  ${message}`));
  if (hint) console.log(dim(`  ${hint}`));
  process.exitCode = 1;
}

function parseInteger(raw: string, label: string, min: 0 | 1): number | undefined {
  const value = Number(raw);
  if (!/^[0-9]+$/.test(raw) || !Number.isSafeInteger(value) || value < min) {
    fail(`${label} must be a ${min === 0 ? "non-negative" : "positive"} integer`);
    return undefined;
  }
  return value;
}

function printSection(name: ConfigSectionName, config: ConfigFile): void {
  const section = config[name];
  console.log(`\n  ${bold(`${name}:`)}`);
  if (!section || Object.keys(section).length === 0) {
    console.log(dim("    (empty)"));
  } else {
    for (const [key, value] of Object.entries(section)) {
      console.log(`    ${cyan(key)}  ${gray(JSON.stringify(value))}`);
    }
  }
  const envHint: Record<ConfigSectionName, string> = {
    harnesses: "env twin: EVAL_<HARNESS>_MODELS (wins over harnesses.<h>.models)",
    providers: `env twin: ${PROVIDER_CONCURRENCY_ENV}, e.g. openai=6,anthropic=4 (wins over providers.*)`,
    verifier: `env twins: ${VERIFIER_MODEL_ENV}, EVAL_MAX_UNVERIFIABLE_CRITERIA (win over verifier.*)`,
    campaign: "env twin: EVAL_CAMPAIGN_TAG (wins over campaign.tag)",
  };
  console.log(`    ${dim(envHint[name])}\n`);
}

export function handleConfigSection(
  name: ConfigSectionName,
  args: string[],
  entryDir: string,
  scope: ConfigScope,
): void {
  if (args.length === 0) {
    printSection(name, readConfig(entryDir));
    return;
  }
  const verb = args[0];
  if (verb !== "set" && verb !== "reset") {
    fail(`Unknown ${name} subcommand "${verb}"`, `Usage: config ${name} [set … | reset …]`);
    return;
  }
  // Each handler validates its input, then applies one mutation. The config
  // it mutates is the effective one (local scope) or the tracked file alone
  // (--shared), so a shared write never carries personal overrides along.
  const apply = (mutate: (config: ConfigFile) => void) => updateConfig(entryDir, mutate, { scope });
  switch (name) {
    case "harnesses":
      return handleHarnesses(verb, args.slice(1), apply, scope);
    case "providers":
      return handleProviders(verb, args.slice(1), apply, scope);
    case "verifier":
      return handleVerifier(verb, args.slice(1), apply, scope);
    case "campaign":
      return handleCampaign(verb, args.slice(1), apply, scope);
  }
}

type Apply = (mutate: (config: ConfigFile) => void) => void;

function handleHarnesses(
  verb: "set" | "reset",
  args: string[],
  apply: Apply,
  scope: ConfigScope,
): void {
  const harness = args[0];
  if (!harness || !isBenchHarness(harness)) {
    fail(
      `Unknown harness "${harness ?? ""}"`,
      `Registered harnesses: ${listBenchHarnesses().join(", ")}`,
    );
    return;
  }
  if (verb === "reset") {
    apply((config) => {
      const harnesses = { ...config.harnesses };
      delete harnesses[harness];
      config.harnesses = harnesses;
    });
    console.log(green(`  ✓ Reset harnesses.${harness}${scopeSuffix(scope)}`));
    return;
  }
  const key = args[1] as (typeof HARNESS_KEYS)[number] | undefined;
  const raw = args.slice(2).join(" ");
  if (!key || !HARNESS_KEYS.includes(key) || !raw) {
    fail("Usage: config harnesses set <harness> models a,b | tool <surface> | nodeOptions <flags>");
    return;
  }
  let patch: HarnessConfigSection;
  if (key === "models") {
    if (!getBenchHarness(harness).defaultModels) {
      fail(
        `Harness "${harness}" picks models per task category; harnesses.${harness}.models does not apply.`,
        "Use -m/--model or EVAL_MODELS to choose its models.",
      );
      return;
    }
    const models = raw
      .split(",")
      .map((model) => model.trim())
      .filter(Boolean);
    if (models.length === 0) {
      fail("models must be a comma-separated list of model ids");
      return;
    }
    patch = { models };
  } else if (key === "tool") {
    const supported = getBenchHarness(harness).supportedToolSurfaces as string[];
    if (supported.length === 0) {
      fail(`Harness "${harness}" mounts no tool surface; --tool does not apply.`);
      return;
    }
    if (!supported.includes(raw)) {
      fail(`Harness "${harness}" supports --tool ${supported.join(", ")}; received "${raw}".`);
      return;
    }
    patch = { tool: raw };
  } else {
    patch = { nodeOptions: raw };
  }
  apply((config) => {
    config.harnesses = {
      ...config.harnesses,
      [harness]: { ...config.harnesses?.[harness], ...patch },
    };
  });
  console.log(green(`  ✓ Set harnesses.${harness}.${key}${scopeSuffix(scope)}`));
}

function handleProviders(
  verb: "set" | "reset",
  args: string[],
  apply: Apply,
  scope: ConfigScope,
): void {
  const provider = args[0]?.toLowerCase();
  if (!provider || !/^[a-z0-9_.-]+$/.test(provider)) {
    fail("Usage: config providers set <provider> concurrency <n> | reset <provider>");
    return;
  }
  if (verb === "reset") {
    apply((config) => {
      const providers = { ...config.providers };
      delete providers[provider];
      config.providers = providers;
    });
    console.log(green(`  ✓ Reset providers.${provider}${scopeSuffix(scope)}`));
    return;
  }
  const key = args[1] as (typeof PROVIDER_KEYS)[number] | undefined;
  if (key !== "concurrency" || args.length < 3) {
    fail("Usage: config providers set <provider> concurrency <n>");
    return;
  }
  const value = parseInteger(args[2], "concurrency", 1);
  if (value === undefined) return;
  apply((config) => {
    const current: ProviderConfigSection = { ...config.providers?.[provider], concurrency: value };
    config.providers = { ...config.providers, [provider]: current };
  });
  console.log(green(`  ✓ Set providers.${provider}.concurrency to ${value}${scopeSuffix(scope)}`));
}

function handleVerifier(
  verb: "set" | "reset",
  args: string[],
  apply: Apply,
  scope: ConfigScope,
): void {
  if (verb === "reset") {
    apply((config) => {
      delete config.verifier;
    });
    console.log(green(`  ✓ Reset verifier${scopeSuffix(scope)}`));
    return;
  }
  const key = args[0] as (typeof VERIFIER_KEYS)[number] | undefined;
  const raw = args.slice(1).join(" ");
  if (!key || !VERIFIER_KEYS.includes(key) || !raw) {
    fail("Usage: config verifier set model <provider/model> | maxUnverifiableCriteria <n>");
    return;
  }
  if (key === "model") {
    if (!/^[^\s/]+\/\S+$/.test(raw)) {
      fail(
        `verifier model must be provider/model, e.g. google/gemini-3.5-flash; received "${raw}"`,
      );
      return;
    }
    apply((config) => {
      config.verifier = { ...config.verifier, model: raw };
    });
  } else if (raw === "null" || raw === "none") {
    apply((config) => {
      const verifier = { ...config.verifier };
      delete verifier.maxUnverifiableCriteria;
      config.verifier = verifier;
    });
  } else {
    const value = parseInteger(raw, key, 0);
    if (value === undefined) return;
    apply((config) => {
      config.verifier = { ...config.verifier, maxUnverifiableCriteria: value };
    });
  }
  console.log(green(`  ✓ Set verifier.${key}${scopeSuffix(scope)}`));
}

function handleCampaign(
  verb: "set" | "reset",
  args: string[],
  apply: Apply,
  scope: ConfigScope,
): void {
  if (verb === "reset") {
    apply((config) => {
      delete config.campaign;
    });
    console.log(green(`  ✓ Reset campaign${scopeSuffix(scope)}`));
    return;
  }
  const key = args[0] as (typeof CAMPAIGN_KEYS)[number] | undefined;
  const raw = args.slice(1).join(" ").trim();
  if (key !== "tag" || !raw) {
    fail("Usage: config campaign set tag <value>");
    return;
  }
  apply((config) => {
    config.campaign = { ...config.campaign, tag: raw };
  });
  console.log(green(`  ✓ Set campaign.tag to ${raw}${scopeSuffix(scope)}`));
}
