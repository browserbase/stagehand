import { bold, dim, cyan, gray, padRight, dustyCyanHeader } from "../format.js";

const HELP_COL_WIDTH = 34;

function row(left: string, right: string, width = HELP_COL_WIDTH): string {
  return `    ${padRight(left, width)} ${right}`;
}

function print(lines: string[]): void {
  console.log(lines.join("\n"));
}

export function printHelp(): void {
  print([
    "",
    `  ${dustyCyanHeader("Commands:")}`,
    "",
    row(`${cyan("run")} ${dim("[target] [options]")}`, "Run evals"),
    row(
      `${cyan("list")} ${dim("[tier] [--detailed]")}`,
      "List tasks and categories",
    ),
    row(
      `${cyan("config")} ${dim("[subcommand]")}`,
      "Get/set default run configuration",
    ),
    row(
      `${cyan("experiments")} ${dim("[subcommand]")}`,
      "Inspect and compare Braintrust experiment runs",
    ),
    row(`${cyan("new")} ${dim("<tier> <cat> <name>")}`, "Scaffold a new task"),
    row(cyan("help"), "Show this help"),
    row(cyan("clear"), "Clear the screen"),
    row(cyan("exit"), "Exit the REPL"),
    "",
    `  ${dim("Use")} ${cyan("<command> --help")} ${dim("for details on a specific command.")}`,
    "",
  ]);
}

export function printRunHelp(): void {
  print([
    "",
    `  ${dustyCyanHeader("evals run")} ${dim("[target] [options]")}`,
    "",
    `  ${bold("Targets:")}`,
    "",
    row(`${dim("(none)")} / ${cyan("all")}`, "All bench tasks"),
    row(`${cyan("core")} / ${cyan("bench")}`, "Entire tier"),
    row(cyan("core:navigation"), "Tier-qualified category"),
    row(
      `${cyan("act")} / ${cyan("extract")} / ${cyan("agent")}`,
      "Category (searched across tiers)",
    ),
    row(cyan("dropdown"), "Specific task name"),
    row(cyan("navigation/open"), "Task with its category prefix"),
    row(
      `${cyan("b:webvoyager")} / ${cyan("benchmark:onlineMind2Web")}`,
      "Benchmark suite shorthand",
    ),
    row(cyan("b:webtailbench"), "WebTailBench benchmark shorthand"),
    "",
    `  ${bold("Options:")}`,
    "",
    row(`${cyan("-t, --trials")} ${dim("<n>")}`, "Number of trials per task"),
    row(`${cyan("-c, --concurrency")} ${dim("<n>")}`, "Max parallel sessions"),
    row(
      `${cyan("-e, --env")} ${dim("<env>")}`,
      `Environment: ${gray("local | browserbase")}`,
    ),
    row(`${cyan("-m, --model")} ${dim("<model>")}`, "Model override"),
    row(
      `${cyan("-p, --provider")} ${dim("<name>")}`,
      `Provider: ${gray("openai | anthropic | google | ...")}`,
    ),
    row(cyan("--api"), "Use Stagehand API mode"),
    "",
    `  ${bold("Core options:")}`,
    "",
    row(
      `${cyan("--tool")} ${dim("<surface>")}`,
      `Core tool surface ${gray("(understudy_code, playwright_code, ...)")}`,
    ),
    row(`${cyan("--startup")} ${dim("<profile>")}`, "Core startup profile"),
    "",
    `  ${bold("Benchmark options:")}`,
    "",
    row(
      `${cyan("--harness")} ${dim("<name>")}`,
      `Bench harness ${gray("(stagehand | claude_code | codex)")}`,
    ),
    row(
      `${cyan("--agent-mode")} ${dim("<mode>")}`,
      `Single Stagehand agent mode ${gray("(dom | hybrid | cua)")}`,
    ),
    row(
      `${cyan("--agent-modes")} ${dim("<csv>")}`,
      `Stagehand mode matrix ${gray("(dom,hybrid,cua)")}`,
    ),
    row(`${cyan("-l, --limit")} ${dim("<n>")}`, "Max cases to run"),
    row(`${cyan("-s, --sample")} ${dim("<n>")}`, "Random sample before limit"),
    row(
      `${cyan("-f, --filter")} ${dim("key=value")}`,
      `Benchmark-specific filter ${gray("(repeatable)")}`,
    ),
    "",
    `  ${bold("Inspect:")}`,
    "",
    row(
      cyan("--preview"),
      `Print a human-readable plan ${gray("(combinations + tasks)")} and exit`,
    ),
    "",
    `  ${bold("Escape hatch:")}`,
    "",
    row(
      cyan("--legacy"),
      `Spawn the pre-refactor ${dim("index.eval.ts")} runner ${gray("(argv only)")}`,
    ),
    "",
    `  ${bold("Examples:")}`,
    "",
    `    ${dim("$")} evals run act -t 3 -c 5`,
    `    ${dim("$")} evals run navigation/open --tool understudy_code`,
    `    ${dim("$")} evals run b:webvoyager -l 10`,
    `    ${dim("$")} evals run b:onlineMind2Web -l 25`,
    `    ${dim("$")} evals run b:webtailbench -l 10`,
    `    ${dim("$")} evals run agent --preview`,
    "",
  ]);
}

export function printListHelp(): void {
  print([
    "",
    `  ${bold("evals list")} ${dim("[tier] [--detailed|-d]")}`,
    "",
    `  ${bold("Filters:")}`,
    "",
    row(dim("(none)"), "All tasks across all tiers"),
    row(cyan("core"), "Core tier tasks only"),
    row(cyan("bench"), "Bench tier tasks only"),
    "",
    `  ${bold("Options:")}`,
    "",
    row(cyan("--detailed, -d"), "Show every task name (not just counts)"),
    "",
  ]);
}

export function printNewHelp(): void {
  print([
    "",
    `  ${bold("evals new")} ${dim("<tier> <category> <name>")}`,
    "",
    `  ${bold("Arguments:")}`,
    "",
    row(cyan("tier"), `${gray("core")} or ${gray("bench")}`),
    row(cyan("category"), `Subdirectory name ${dim("(e.g. navigation, act)")}`),
    row(cyan("name"), `Task name ${dim("(lowercase, underscores)")}`),
    "",
    `  ${bold("Examples:")}`,
    "",
    `    ${dim("$")} evals new core navigation back`,
    `    ${dim("$")} evals new bench act my_new_eval`,
    "",
  ]);
}

export function printConfigHelp(): void {
  print([
    "",
    `  ${dustyCyanHeader("evals config")} ${dim("[subcommand]")}`,
    "",
    `  ${bold("Subcommands:")}`,
    "",
    row(dim("(none)"), "Print current defaults + env overrides"),
    row(cyan("path"), "Print the evals.config.json file path"),
    row(
      `${cyan("set")} ${dim("<key> <value>")}`,
      `Set a default ${gray("(env/trials/concurrency/provider/model/api/verbose/agentModes)")}`,
    ),
    row(`${cyan("reset")} ${dim("[key]")}`, "Reset one key or all defaults"),
    row(
      `${cyan("core")} ${dim("[...]")}`,
      "Configure core tier tool + startup defaults",
    ),
    "",
    `  ${bold("Core subcommands:")} ${dim("(under `evals config core`)")}`,
    "",
    row(dim("(none)"), "Print current core configuration"),
    row(cyan("path"), "Print the config file path"),
    row(
      `${cyan("set")} ${dim("<tool|startup> <value>")}`,
      `Set core ${cyan("tool")} or ${cyan("startup")}`,
    ),
    row(
      `${cyan("reset")} ${dim("[key]")}`,
      "Reset one key or the whole core section",
    ),
    row(cyan("setup"), `Interactive wizard ${gray("(coming soon)")}`),
    "",
    `  ${bold("Valid core tools:")} ${gray("understudy_code, playwright_code, cdp_code, playwright_mcp, chrome_devtools_mcp, browse_cli")}`,
    "",
    `  ${bold("Examples:")}`,
    "",
    `    ${dim("$")} evals config set trials 5`,
    `    ${dim("$")} evals config core set tool understudy_code`,
    `    ${dim("$")} evals config core set startup tool_launch_local`,
    `    ${dim("$")} evals config core reset`,
    "",
  ]);
}

export function printExperimentsHelp(
  subcommand?: "list" | "show" | "open" | "compare",
): void {
  if (subcommand === "list") {
    print([
      "",
      `  ${dustyCyanHeader("evals experiments list")}`,
      "",
      "  Show recent Braintrust experiment runs.",
      "",
      `  ${bold("Options:")}`,
      "",
      row(`${cyan("--project")} ${dim("<name>")}`, "Restrict to one project"),
      row(`${cyan("--limit")} ${dim("<n>")}`, "Number of recent runs to fetch"),
      row(cyan("--json"), "Emit machine-readable JSON"),
      "",
      `  ${bold("Defaults:")}`,
      "",
      `    ${gray("Projects:")} stagehand-dev, stagehand-core-dev`,
      `    ${gray("Limit:")}    5 per project`,
      "",
    ]);
    return;
  }

  if (subcommand === "show") {
    print([
      "",
      `  ${dustyCyanHeader("evals experiments show")} ${dim("<experiment>")}`,
      "",
      "  Show one Braintrust experiment in detail.",
      "",
      `  ${bold("Options:")}`,
      "",
      row(
        `${cyan("--project")} ${dim("<name>")}`,
        "Restrict lookup to one project",
      ),
      row(cyan("--json"), "Emit machine-readable JSON"),
      "",
    ]);
    return;
  }

  if (subcommand === "open") {
    print([
      "",
      `  ${dustyCyanHeader("evals experiments open")} ${dim("<experiment>")}`,
      "",
      "  Open one Braintrust experiment in the browser.",
      "",
      `  ${bold("Options:")}`,
      "",
      row(
        `${cyan("--project")} ${dim("<name>")}`,
        "Restrict lookup to one project",
      ),
      "",
    ]);
    return;
  }

  if (subcommand === "compare") {
    print([
      "",
      `  ${dustyCyanHeader("evals experiments compare")} ${dim("<exp1> <exp2> [exp3 ...]")}`,
      "",
      "  Generate an HTML comparison report.",
      "",
      `  ${bold("Options:")}`,
      "",
      row(`${cyan("--project")} ${dim("<name>")}`, "Braintrust project"),
      row(`${cyan("--title")} ${dim("<text>")}`, "Report title"),
      row(`${cyan("--out")} ${dim("<path>")}`, "Output HTML path"),
      row(
        cyan("--headless"),
        "Write report files and emit machine-readable JSON",
      ),
      "",
      `  ${bold("Project resolution:")} ${gray("If omitted, inferred per experiment across bench/core projects")}`,
      `  ${bold("Compare modes:")} ${gray("Core compares task/timer rows; bench compares dataset/task/model/agent-mode cases")}`,
      `  ${bold("Mixed modes:")} ${gray("Core + bench comparisons are rejected for now")}`,
      "",
    ]);
    return;
  }

  print([
    "",
    `  ${dustyCyanHeader("evals experiments")} ${dim("[subcommand]")}`,
    "",
    "  Inspect and compare Braintrust experiment runs for evals.",
    "",
    `  ${bold("Subcommands:")}`,
    "",
    row(cyan("list"), "Show recent runs"),
    row(`${cyan("show")} ${dim("<experiment>")}`, "Show one experiment"),
    row(
      `${cyan("open")} ${dim("<experiment>")}`,
      "Open one experiment in the browser",
    ),
    row(
      `${cyan("compare")} ${dim("<exp1> <exp2> [exp3 ...]")}`,
      "Generate an HTML comparison report",
    ),
    "",
    `  ${bold("Defaults:")}`,
    "",
    `    ${gray("list searches")} stagehand-dev ${gray("and")} stagehand-core-dev`,
    "",
    `  ${bold("Examples:")}`,
    "",
    `    ${dim("$")} evals experiments list`,
    `    ${dim("$")} evals experiments show observe-90b34916`,
    `    ${dim("$")} evals experiments open extract-a12c91de`,
    `    ${dim("$")} evals experiments compare exp1 exp2 --project stagehand-core-dev`,
    "",
  ]);
}
