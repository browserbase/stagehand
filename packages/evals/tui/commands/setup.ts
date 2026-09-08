/**
 * `evals setup` — get this machine ready to run agent benchmarks.
 *
 * Detects what's already present (a provider key, a browser), asks only for
 * what's missing, writes it to packages/evals/.env, re-detects, and offers to
 * run the first real case. Keys are entered masked and never echoed back.
 * Off-TTY it prints the static checklist instead of prompting.
 */

import fs from "node:fs";
import path from "node:path";
import * as clack from "@clack/prompts";
import { bold, cyan, dim, green, red } from "../format.js";
import { getPackageRootDir } from "../../runtimePaths.js";
import { markFirstRunComplete } from "../welcomeState.js";
import type { CommandContext } from "../commandTree.js";
import { detectMachine, firstRunCommand, type Machine } from "../welcome/detect.js";

export function printSetupHelp(): void {
  console.log(
    [
      "",
      `  ${bold("evals setup")}`,
      "",
      `  ${dim("Guided setup for agent benchmarks: detects what's present, asks only for")}`,
      `  ${dim("what's missing (provider key, browser), writes packages/evals/.env, and")}`,
      `  ${dim("offers to run the first real case. Non-interactive terminals get a checklist.")}`,
      "",
    ].join("\n"),
  );
}

type Provider = "anthropic" | "openai";
const KEY_VAR: Record<Provider, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
};

/** Upsert `KEY=value` lines in a dotenv file body; other lines are preserved. */
export function upsertEnv(body: string, entries: Record<string, string>): string {
  const lines = body.length ? body.split("\n") : [];
  const seen = new Set<string>();
  const out = lines.map((line) => {
    const m = /^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=/.exec(line);
    if (m && entries[m[1]] !== undefined) {
      seen.add(m[1]);
      return `${m[1]}=${entries[m[1]]}`;
    }
    return line;
  });
  while (out.length && out[out.length - 1] === "") out.pop();
  for (const [k, v] of Object.entries(entries)) if (!seen.has(k)) out.push(`${k}=${v}`);
  return out.join("\n") + "\n";
}

function writeEnv(entries: Record<string, string>): string {
  const envPath = path.join(getPackageRootDir(), ".env");
  const existing = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
  fs.writeFileSync(envPath, upsertEnv(existing, entries), { mode: 0o600 });
  fs.chmodSync(envPath, 0o600); // `mode` only applies to new files
  // Make the new values visible to detection in this process (the package
  // .env is read once and cached).
  for (const [k, v] of Object.entries(entries)) process.env[k] = v;
  return envPath;
}

function status(m: Machine): string[] {
  const ok = (s: string): string => `  ${green("✓")} ${s}`;
  const todo = (s: string): string => `  ${red("–")} ${s}`;
  const rows: string[] = [];
  const provider = (["anthropic", "openai"] as const).find((p) => m.providers.includes(p));
  rows.push(
    provider
      ? ok(
          `provider key: ${provider.toUpperCase()} ${dim(`(${provider === "anthropic" ? "claude_code" : "codex"} harness)`)}`,
        )
      : todo("provider key: none usable (Anthropic → claude_code, OpenAI → codex)"),
  );
  rows.push(
    m.chrome
      ? ok(`browser: local Chrome ${dim(`(${m.chrome})`)}`)
      : m.browserbase
        ? ok("browser: Browserbase (hosted)")
        : todo("browser: no local Chrome, no Browserbase credentials"),
  );
  return rows;
}

function printChecklist(m: Machine): void {
  const envPath = path.join(getPackageRootDir(), ".env");
  const lines = ["", `  ${bold("Set up agent benchmarks")}`, "", ...status(m), ""];
  if (m.plan.kind === "real") {
    lines.push(
      `  ${bold("You're set.")} ${dim("Try:")}`,
      `      ${cyan(`evals ${firstRunCommand(m.plan)}`)}`,
    );
  } else {
    lines.push(`  ${dim("Add to")} ${cyan(envPath)}${dim(":")}`);
    if (!m.providers.includes("anthropic") && !m.providers.includes("openai"))
      lines.push(`      ${cyan("ANTHROPIC_API_KEY")}=…  ${dim("or")}  ${cyan("OPENAI_API_KEY")}=…`);
    if (!m.chrome && !m.browserbase)
      lines.push(
        `      ${cyan("BROWSERBASE_API_KEY")}=…  ${cyan("BROWSERBASE_PROJECT_ID")}=…  ${dim("(or install Google Chrome)")}`,
      );
    lines.push(
      "",
      `  ${dim("Then")} ${cyan("evals doctor")} ${dim("to confirm, and")} ${cyan("evals setup")} ${dim("again for a guided run.")}`,
    );
  }
  lines.push("");
  console.log(lines.join("\n"));
}

export async function handleSetup(args: string[], ctx?: CommandContext): Promise<void> {
  if (args[0] === "--help" || args[0] === "-h" || args[0] === "help") {
    printSetupHelp();
    return;
  }
  let m = detectMachine();
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    printChecklist(m);
    return;
  }

  const restore = ctx?.suspendInput?.() ?? (() => {});
  let runNext: string | null = null;
  let saved = false;
  const cancel = (): void => {
    clack.cancel(
      saved ? "Setup cancelled — your keys were saved." : "Setup cancelled — nothing was written.",
    );
  };
  try {
    clack.intro(bold("Set up agent benchmarks"));
    clack.note(status(m).join("\n"), "This machine");

    const entries: Record<string, string> = {};

    // 1. A provider key (the provider picks the harness). Only when neither
    // harness-capable key is present — a missing browser alone shouldn't re-ask.
    if (!m.providers.includes("anthropic") && !m.providers.includes("openai")) {
      const provider = await clack.select<Provider>({
        message: "Which model provider will run the agent?",
        options: [
          {
            value: "anthropic",
            label: "Anthropic",
            hint: "claude_code harness · ANTHROPIC_API_KEY",
          },
          { value: "openai", label: "OpenAI", hint: "codex harness · OPENAI_API_KEY" },
        ],
        initialValue: "anthropic",
      });
      if (clack.isCancel(provider)) return cancel();
      const key = await clack.password({
        message: `Paste your ${KEY_VAR[provider]}`,
        validate: (v) => (v && v.trim().length >= 8 ? undefined : "That doesn't look like a key."),
      });
      if (clack.isCancel(key)) return cancel();
      entries[KEY_VAR[provider]] = key.trim();
    }

    // 2. A browser.
    if (!m.chrome && !m.browserbase) {
      const browser = await clack.select<"browserbase" | "chrome">({
        message: "No browser found. How should the agent drive one?",
        options: [
          {
            value: "browserbase",
            label: "Browserbase (hosted)",
            hint: "needs an API key + project id",
          },
          {
            value: "chrome",
            label: "I'll install Google Chrome",
            hint: "re-run `evals setup` afterwards",
          },
        ],
        initialValue: "browserbase",
      });
      if (clack.isCancel(browser)) return cancel();
      if (browser === "browserbase") {
        // Ask only for the half that's missing.
        if (m.keys.browserbase.apiKey !== "set") {
          const apiKey = await clack.password({
            message: "BROWSERBASE_API_KEY",
            validate: (v) =>
              v && v.trim().length >= 8 ? undefined : "That doesn't look like a key.",
          });
          if (clack.isCancel(apiKey)) return cancel();
          entries.BROWSERBASE_API_KEY = apiKey.trim();
        }
        if (m.keys.browserbase.projectId !== "set") {
          const projectId = await clack.text({
            message: "BROWSERBASE_PROJECT_ID",
            validate: (v) =>
              v && v.trim().length >= 8 ? undefined : "That doesn't look like a project id.",
          });
          if (clack.isCancel(projectId)) return cancel();
          entries.BROWSERBASE_PROJECT_ID = projectId.trim();
        }
      }
    }

    // 3. Persist, re-detect, show the result.
    if (Object.keys(entries).length) {
      const envPath = writeEnv(entries);
      saved = true;
      clack.log.success(`Saved ${Object.keys(entries).join(", ")} to ${cyan(envPath)}`);
      m = detectMachine();
      clack.note(status(m).join("\n"), "Now");
    }

    // 4. Offer the first real run.
    if (m.plan.kind === "real") {
      const cmd = firstRunCommand(m.plan);
      const go = await clack.confirm({
        message: `Run it now?  ${cyan(`evals ${cmd}`)}  ${dim("— three real WebVoyager cases, a few minutes")}`,
        initialValue: true,
      });
      if (clack.isCancel(go)) return cancel();
      if (go) runNext = cmd;
      clack.outro(go ? "Starting your first real run." : `Later: ${cyan(`evals ${cmd}`)}`);
    } else {
      clack.outro(`Install Chrome, then run ${cyan("evals setup")} again.`);
    }
    // Completed (not cancelled): this counts as first use.
    if (ctx) markFirstRunComplete(ctx.entryDir);
  } finally {
    restore();
  }

  if (!runNext || !ctx) return;
  // "Enter to run it" means run it — in the REPL too. Pop any nested REPL
  // context first so the command resolves from the root of the tree.
  ctx.setContextPath?.([]);
  const { buildCommandTree, dispatch, tokenize } = await import("../commandTree.js");
  await dispatch(buildCommandTree(), tokenize(runNext), ctx);
}
