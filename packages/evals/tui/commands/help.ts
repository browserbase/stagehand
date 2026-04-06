import { bold, dim, cyan, gray } from "../format.js";

export function printHelp(): void {
  console.log(`
  ${bold("Commands:")}

    ${cyan("run")} ${dim("[target] [options]")}    Run evals
    ${cyan("list")} ${dim("[tier]")}               List tasks and categories
    ${cyan("config")}                    Show current configuration
    ${cyan("new")} ${dim("<tier> <cat> <name>")}   Scaffold a new task
    ${cyan("help")}                      Show this help
    ${cyan("clear")}                     Clear the screen
    ${cyan("exit")}                      Exit the REPL

  ${dim("Use")} ${cyan("<command> --help")} ${dim("for details on a specific command.")}
`);
}

export function printRunHelp(): void {
  console.log(`
  ${bold("evals run")} ${dim("[target] [options]")}

  ${bold("Targets:")}

    ${dim("(none)")}                     All bench tasks ${dim("(default)")}
    ${cyan("core")}                      All core tier tasks
    ${cyan("act")}                       Category name ${dim("(searched across tiers)")}
    ${cyan("core:navigation")}           Tier-qualified category
    ${cyan("dropdown")}                  Specific task by name

  ${bold("Options:")}

    ${cyan("-t, --trials")} ${dim("<n>")}          Number of trials per task
    ${cyan("-c, --concurrency")} ${dim("<n>")}     Max parallel sessions
    ${cyan("-e, --env")} ${dim("<env>")}           Environment: ${gray("local | browserbase")}
    ${cyan("-m, --model")} ${dim("<model>")}       Model override
    ${cyan("-p, --provider")} ${dim("<name>")}     Provider: ${gray("openai | anthropic | google | ...")}
    ${cyan("--api")}                     Use Stagehand API mode
`);
}

export function printListHelp(): void {
  console.log(`
  ${bold("evals list")} ${dim("[filter]")}

  ${bold("Filters:")}

    ${dim("(none)")}                     All tasks across all tiers
    ${cyan("core")}                      Core tier tasks only
    ${cyan("bench")}                     Bench tier tasks only
`);
}

export function printNewHelp(): void {
  console.log(`
  ${bold("evals new")} ${dim("<tier> <category> <name>")}

  ${bold("Arguments:")}

    ${cyan("tier")}                      ${gray("core")} or ${gray("bench")}
    ${cyan("category")}                  Subdirectory name ${dim("(e.g. navigation, act)")}
    ${cyan("name")}                      Task name ${dim("(lowercase, underscores)")}

  ${bold("Examples:")}

    ${dim("$")} evals new core navigation back
    ${dim("$")} evals new bench act my_new_eval
`);
}

export function printConfigHelp(): void {
  console.log(`
  ${bold("evals config")}

  Shows the current configuration from ${dim("evals.config.json")} defaults
  and any active environment variable overrides.
`);
}
