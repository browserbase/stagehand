import { bold, cyan, dim, green, red } from "./format.js";
import type { EnvSnapshot } from "./welcomeStatus.js";
import type { TaskRegistry } from "../framework/types.js";

function tagIcon(state: "set" | "missing"): string {
  return state === "set" ? green("✓") : red("✗");
}

function providerLabel(s: EnvSnapshot): string {
  const parts = [
    `${tagIcon(s.openai.state)} openai`,
    `${tagIcon(s.anthropic.state)} anthropic`,
    `${tagIcon(s.google.state)} google`,
  ];
  return parts.join("  ");
}

function browserbaseLabel(s: EnvSnapshot): string {
  if (s.browserbase.apiKey === "set" && s.browserbase.projectId === "set") {
    return green("✓");
  }
  if (s.browserbase.apiKey === "missing" && s.browserbase.projectId === "missing") {
    return red("✗");
  }
  return red("⚠");
}

export type WelcomeContext = {
  snapshot: EnvSnapshot;
  registry: TaskRegistry;
};

export function printExtendedWelcome(ctx: WelcomeContext): void {
  const lines: string[] = [];
  lines.push("");
  lines.push(`  ${bold("Welcome to Stagehand evals.")}`);
  lines.push("");
  lines.push(
    `  ${dim("·")} Type a command (e.g. ${cyan("list")}) or a run target (e.g. ${cyan("act")}).`,
  );
  lines.push(
    `  ${dim("·")} ${cyan("help")} for commands · ${cyan("evals doctor")} for env health · ${cyan("exit")} to quit.`,
  );
  lines.push("");
  lines.push(`  ${bold("Health")}`);
  lines.push(
    `    AI:  ${providerLabel(ctx.snapshot)}     BB: ${browserbaseLabel(ctx.snapshot)}     Braintrust: ${tagIcon(ctx.snapshot.braintrust.state)}`,
  );
  lines.push(`    ${dim("Run")} ${cyan("evals doctor")} ${dim("for setup help.")}`);
  lines.push("");
  lines.push(`  ${bold("Try first")}`);
  lines.push(`    ${cyan("list")}                       ${dim("# see what tasks exist")}`);
  lines.push(
    `    ${cyan("run agent")}                  ${dim("# run the agent category once (env=local)")}`,
  );
  lines.push(
    `    ${cyan("experiments list")}           ${dim("# recent Braintrust runs (needs BRAINTRUST_API_KEY)")}`,
  );
  lines.push(`    ${cyan("config")}                     ${dim("# see your defaults")}`);
  lines.push("");
  console.log(lines.join("\n"));
}

export function printTipLine(): void {
  console.log(
    `  ${dim("Type")} ${cyan("help")} ${dim("for commands,")} ${cyan("exit")} ${dim("to quit")}`,
  );
}
