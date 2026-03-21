import * as readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import type { ActResult, Action } from "./types/public/methods.js";
import type { Page } from "./understudy/page.js";

export interface ChatContext {
  act: (instruction: string) => Promise<ActResult>;
  extract: (instruction: string) => Promise<{ extraction: string }>;
  observe: (instruction: string) => Promise<Action[]>;
  page: Page;
}

const tty = stdout.isTTY ?? false;
const dim = (s: string) => (tty ? `\x1b[2m${s}\x1b[0m` : s);
const grn = (s: string) => (tty ? `\x1b[32m${s}\x1b[0m` : s);
const cyn = (s: string) => (tty ? `\x1b[36m${s}\x1b[0m` : s);
const red = (s: string) => (tty ? `\x1b[31m${s}\x1b[0m` : s);

// Extract the arg from parens: foo("bar") → "bar", foo() → undefined
function arg(input: string): string | undefined {
  const m = input.match(/\(\s*["'`](.+?)["'`]\s*\)/);
  return m?.[1];
}

const commands: Record<
  string,
  (ctx: ChatContext, raw: string) => Promise<string>
> = {
  // page.*
  "page.url": async (ctx) => cyn(`  → ${ctx.page.url()}`),
  "page.title": async (ctx) => cyn(`  → ${await ctx.page.title()}`),
  "page.goto": async (ctx, raw) => {
    const url = arg(raw);
    if (!url) return dim('  page.goto("https://...")');
    await ctx.page.goto(url);
    return grn(`  ✓ ${ctx.page.url()}`);
  },
  "page.reload": async (ctx) => {
    await ctx.page.reload();
    return grn("  ✓ reloaded");
  },

  // stagehand.*
  "act": async (ctx, raw) => {
    const instruction = arg(raw);
    if (!instruction) return dim('  stagehand.act("...")');
    const r = await ctx.act(instruction);
    return r.success ? grn(`  ✓ ${r.message}`) : red(`  ✗ ${r.message}`);
  },
  "extract": async (ctx, raw) => {
    const instruction = arg(raw);
    if (!instruction) return dim('  stagehand.extract("...")');
    const r = await ctx.extract(instruction);
    return cyn(`  → "${r.extraction}"`);
  },
  "observe": async (ctx, raw) => {
    const instruction = arg(raw);
    if (!instruction) return dim('  stagehand.observe("...")');
    const actions = await ctx.observe(instruction);
    if (actions.length === 0) return dim("  (no actions found)");
    return actions
      .map((a) => cyn(`  → ${a.description}`) + dim(a.method ? ` (${a.method})` : ""))
      .join("\n");
  },
};

// Match "stagehand.act(...)" or "act(...)" or "page.goto(...)"
function resolve(input: string): string | null {
  const lower = input.toLowerCase();
  for (const key of Object.keys(commands)) {
    if (lower.startsWith(key + "(") || lower.startsWith("stagehand." + key + "(")) {
      return key;
    }
    // bare: page.url()
    if (lower === key + "()" || lower === "stagehand." + key + "()") {
      return key;
    }
  }
  return null;
}

export async function chat(ctx: ChatContext): Promise<void> {
  if (!stdin.isTTY) {
    console.log(dim("[stagehand] chat() requires an interactive terminal, skipping."));
    return;
  }

  console.log();
  console.log(dim(`  Stagehand paused on ${ctx.page.url()}`));
  console.log(dim("  Type help for commands. Press Enter to continue.\n"));

  const rl = readline.createInterface({ input: stdin, output: stdout });

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const line = await rl.question("🤘 ");

    if (line.trim() === "") {
      rl.close();
      return;
    }

    if (line.trim().toLowerCase() === "help") {
      console.log();
      console.log(dim("  stagehand.act(\"...\")      Perform an action on the page"));
      console.log(dim("  stagehand.extract(\"...\")  Extract data from the page"));
      console.log(dim("  stagehand.observe(\"...\")  Find candidate actions"));
      console.log();
      console.log(dim("  page.url()                Current page URL"));
      console.log(dim("  page.title()              Current page title"));
      console.log(dim("  page.goto(\"...\")          Navigate to a URL"));
      console.log(dim("  page.reload()             Reload the page"));
      console.log();
      console.log(dim("  Enter                     Continue script execution"));
      console.log();
      continue;
    }

    const key = resolve(line.trim());
    if (!key) {
      console.log(dim("  Unknown command. Type help for a list of commands."));
      continue;
    }

    try {
      console.log(await commands[key](ctx, line.trim()));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(red(`  ✗ ${msg}`));
    }
  }
}
