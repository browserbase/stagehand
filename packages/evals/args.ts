import process from "process";
import { EvalCategorySchema } from "./types/evals";
import chalk from "chalk";
import { dedent } from "./utils";

const HELP_REGEX = /^(?:--?)?(?:h|help)$/i;
const MAN_REGEX = /^(?:--?)?man$/i;

const rawArgs = process.argv.slice(2);

const parsedArgs: {
  evalName?: string;
  env?: string;
  api?: string;
  trials?: number;
  concurrency?: number;
  provider?: string;
  dataset?: string;
  max_k?: number;
  leftover: string[];
} = {
  leftover: [],
};

for (const arg of rawArgs) {
  if (arg.startsWith("env=")) {
    parsedArgs.env = arg.split("=")[1]?.toLowerCase();
  } else if (arg.startsWith("api=")) {
    parsedArgs.api = arg.split("=")[1]?.toLowerCase();
  } else if (arg.startsWith("name=")) {
    parsedArgs.evalName = arg.split("=")[1];
  } else if (arg.startsWith("trials=")) {
    const val = parseInt(arg.split("=")[1], 10);
    if (!isNaN(val)) {
      parsedArgs.trials = val;
    }
  } else if (arg.startsWith("concurrency=")) {
    const val = parseInt(arg.split("=")[1], 10);
    if (!isNaN(val)) {
      parsedArgs.concurrency = val;
    }
  } else if (arg.startsWith("provider=")) {
    parsedArgs.provider = arg.split("=")[1]?.toLowerCase();
  } else if (arg.startsWith("--dataset=")) {
    parsedArgs.dataset = arg.split("=")[1]?.toLowerCase();
  } else if (arg.startsWith("max_k=")) {
    const val = parseInt(arg.split("=")[1], 10);
    if (!isNaN(val)) {
      parsedArgs.max_k = val;
    }
  } else {
    parsedArgs.leftover.push(arg);
  }
}

/** Apply environment defaults or overrides */
if (parsedArgs.env === "browserbase") {
  process.env.EVAL_ENV = "BROWSERBASE";
} else if (parsedArgs.env === "local") {
  process.env.EVAL_ENV = "LOCAL";
}

if (parsedArgs.api === "true") {
  process.env.USE_API = "true";
} else if (parsedArgs.api === "false") {
  process.env.USE_API = "false";
}

if (parsedArgs.trials !== undefined) {
  process.env.EVAL_TRIAL_COUNT = String(parsedArgs.trials);
}
if (parsedArgs.concurrency !== undefined) {
  process.env.EVAL_MAX_CONCURRENCY = String(parsedArgs.concurrency);
}
if (parsedArgs.max_k !== undefined) {
  process.env.EVAL_MAX_K = String(parsedArgs.max_k);
}
if (parsedArgs.dataset !== undefined) {
  process.env.EVAL_DATASET = parsedArgs.dataset;
}

const DEFAULT_EVAL_CATEGORIES = process.env.EVAL_CATEGORIES
  ? process.env.EVAL_CATEGORIES.split(",")
  : [
      "observe",
      "act",
      "combination",
      "extract",
      "experimental",
      "targeted_extract",
      "regression_llm_providers",
      "regression",
      "llm_clients",
      "agent",
      "external_agent_benchmarks",
    ];

const providerDefault = process.env.EVAL_PROVIDER ?? undefined;

function buildUsage(detailed = false): string {
  const header = chalk.blue.bold("Stagehand • Eval Runner");
  const synopsis = chalk.cyan(
    `pnpm run evals [key=value]… [category <name>] | name=<evalName>`,
  );

  const examplesSection = `
      ${chalk.magenta.underline("Examples")}

      ${chalk.dim("# Run every evaluation locally with default settings")}
      ${chalk.green("pnpm run evals")}

      ${chalk.dim("# Same as above but in Browserbase with three trials")}  
      ${chalk.green("pnpm run evals")} ${chalk.cyan("env=")}${chalk.yellow("browserbase")} ${chalk.cyan("trials=")}${chalk.yellow("3")}

      ${chalk.dim("# Run evals using the Stagehand API")}
      ${chalk.green("pnpm run evals")} ${chalk.cyan("env=")}${chalk.yellow("browserbase")} ${chalk.cyan("api=")}${chalk.yellow("true")}

      ${chalk.dim("# Run evals from only the 'act' category with a max of 4 running at any given time")}
      ${chalk.green("pnpm run evals")} ${chalk.cyan("category")} ${chalk.yellow("act")} ${chalk.cyan("concurrency=")}${chalk.yellow("4")}

      ${chalk.dim("# Execute a specific eval by filename")}
      ${chalk.green("pnpm run evals")} ${chalk.cyan("name=")}${chalk.yellow("my_eval_name")}
  `;

  const body = dedent`
    ${chalk.magenta.underline("Keys\n")}
  ${chalk.cyan("env".padEnd(12))} ${"target environment".padEnd(24)}
    (default ${chalk.dim("LOCAL")})                [${chalk.yellow("browserbase")}, ${chalk.yellow("local")}]

  ${chalk.cyan("api".padEnd(12))} ${"use the Stagehand API".padEnd(24)}
    (default ${chalk.dim("false")})                [${chalk.yellow("true")}, ${chalk.yellow("false")}]

  ${chalk.cyan("trials".padEnd(12))} ${"number of trials per task".padEnd(24)}
    (default ${chalk.dim("3")})

  ${chalk.cyan("concurrency".padEnd(12))} ${"max parallel sessions".padEnd(24)}
    (default ${chalk.dim("3")})

  ${chalk.cyan("provider".padEnd(12))} ${"override LLM provider".padEnd(24)}
    (default ${chalk.dim(providerDefault || "varies by model")})        [${chalk.yellow("openai")}, ${chalk.yellow("anthropic")}, ${chalk.yellow("google")}, ${chalk.yellow("together")}, ${chalk.yellow("groq")}, ${chalk.yellow("cerebras")}]

  ${chalk.cyan("max_k".padEnd(12))} ${"max test cases per dataset".padEnd(24)}
    (default ${chalk.dim("25")})

  ${chalk.cyan("--dataset".padEnd(12))} ${"filter to specific benchmark".padEnd(24)}
    (optional)              [${chalk.yellow("gaia")}, ${chalk.yellow("webvoyager")}, ${chalk.yellow("webbench")}, ${chalk.yellow("osworld")}, ${chalk.yellow("onlineMind2Web")}]


    ${chalk.magenta.underline("Positional filters\n")}
      
      category <category_name>   
      
        ${chalk.gray("Available categories:")}
        ${DEFAULT_EVAL_CATEGORIES.slice(0, 5)
          .map((c) => chalk.yellow(c))
          .join(", ")},
        ${DEFAULT_EVAL_CATEGORIES.slice(5, 10)
          .map((c) => chalk.yellow(c))
          .join(", ")}${DEFAULT_EVAL_CATEGORIES.slice(10).length > 0 ? "," : ""}
        ${DEFAULT_EVAL_CATEGORIES.slice(10)
          .map((c) => chalk.yellow(c))
          .join(", ")}
  `;

  if (!detailed)
    return `${header}\n\n${synopsis}\n\nFor more details: ${chalk.bold(
      "pnpm run evals -man\n",
    )}`;

  const externalBenchmarksSection = dedent`
    ${chalk.magenta.underline("\nExternal Benchmarks\n")}
    
    ${chalk.cyan.bold("WebBench")} - 5,607 real-world web automation tasks across 452 live websites
    
      ${chalk.dim("Run:")} ${chalk.green("pnpm run evals")} ${chalk.cyan("name=")}${chalk.yellow("agent/webbench")}
      
      ${chalk.dim("Or:")}  ${chalk.green("EVAL_DATASET=webbench pnpm run evals")}
      
      ${chalk.gray("Environment Variables:")}
      
      EVAL_WEBBENCH_LIMIT       max tasks to run (default: 25)
      EVAL_WEBBENCH_SAMPLE      random sample count before limit
      EVAL_WEBBENCH_DIFFICULTY  filter: [${chalk.yellow("easy")}, ${chalk.yellow("hard")}] (254 easy, 61 hard tasks)
      EVAL_WEBBENCH_CATEGORY    filter: [${chalk.yellow("READ")}, ${chalk.yellow("CREATE")}, ${chalk.yellow("UPDATE")}, ${chalk.yellow("DELETE")}, ${chalk.yellow("FILE_MANIPULATION")}]
      EVAL_WEBBENCH_USE_HITL    use only HITL dataset with difficulty ratings (true/false)
      
      ${chalk.dim("Examples:")}
      
      ${chalk.green("EVAL_WEBBENCH_DIFFICULTY=easy EVAL_WEBBENCH_LIMIT=10 pnpm run evals name=agent/webbench")}
      
      ${chalk.green("EVAL_DATASET=webbench EVAL_WEBBENCH_CATEGORY=READ pnpm run evals")}
    
    
    ${chalk.cyan.bold("GAIA")} - General AI Assistant benchmark for complex reasoning
    
      ${chalk.dim("Run:")} ${chalk.green("pnpm run evals")} ${chalk.cyan("name=")}${chalk.yellow("agent/gaia")}
      
      ${chalk.dim("Or:")}  ${chalk.green("EVAL_DATASET=gaia pnpm run evals")}
      
      ${chalk.gray("Environment Variables:")}
      
      EVAL_GAIA_LIMIT           max tasks to run (default: 25)
      EVAL_GAIA_SAMPLE          random sample count before limit
      EVAL_GAIA_LEVEL           filter by difficulty level [${chalk.yellow("1")}, ${chalk.yellow("2")}, ${chalk.yellow("3")}]
      
      ${chalk.dim("Example:")}
      
      ${chalk.green("EVAL_GAIA_LEVEL=1 EVAL_GAIA_LIMIT=10 pnpm run evals name=agent/gaia")}
    
    
    ${chalk.cyan.bold("WebVoyager")} - Web navigation and task completion benchmark
    
      ${chalk.dim("Run:")} ${chalk.green("pnpm run evals")} ${chalk.cyan("name=")}${chalk.yellow("agent/webvoyager")}
      
      ${chalk.dim("Or:")}  ${chalk.green("EVAL_DATASET=webvoyager pnpm run evals")}
      
      ${chalk.gray("Environment Variables:")}
      
      EVAL_WEBVOYAGER_LIMIT     max tasks to run (default: 25)
      EVAL_WEBVOYAGER_SAMPLE    random sample count before limit
      
      ${chalk.gray("Ground Truth Evaluation:")}
      
      WebVoyager uses ground truth answers for improved accuracy:
      • Checks agent's "Final Answer:" against reference answers
      • Supports golden (ideal) and possible (acceptable) answers
      • Falls back to screenshot evaluation when uncertain
      • Reference data: evals/datasets/webvoyager/reference-answers.json
      
      ${chalk.dim("Example:")}
      
      ${chalk.green("EVAL_WEBVOYAGER_SAMPLE=50 EVAL_WEBVOYAGER_LIMIT=10 pnpm run evals name=agent/webvoyager")}
    
    
    ${chalk.cyan.bold("OSWorld")} - Chrome browser automation tasks from the OSWorld benchmark
    
      ${chalk.dim("Run:")} ${chalk.green("pnpm run evals")} ${chalk.cyan("name=")}${chalk.yellow("agent/osworld")}
      
      ${chalk.dim("Or:")}  ${chalk.green("EVAL_DATASET=osworld pnpm run evals")}
      
      ${chalk.gray("Environment Variables:")}
      
      EVAL_OSWORLD_LIMIT           max tasks to run (default: 25)
      EVAL_OSWORLD_SAMPLE          random sample count before limit
      EVAL_OSWORLD_SOURCE          filter by source: [${chalk.yellow("Mind2Web")}, ${chalk.yellow("test_task_1")}, ...]
      EVAL_OSWORLD_EVALUATION_TYPE filter by eval type: [${chalk.yellow("url_match")}, ${chalk.yellow("string_match")}, ${chalk.yellow("dom_state")}, ${chalk.yellow("custom")}]
      EVAL_OSWORLD_TIMEOUT         timeout per task in milliseconds (default: 60000)
      
      ${chalk.dim("Examples:")}
      
      ${chalk.green("EVAL_OSWORLD_SOURCE=Mind2Web EVAL_OSWORLD_LIMIT=10 pnpm run evals name=agent/osworld")}
      
      ${chalk.green("EVAL_DATASET=osworld EVAL_OSWORLD_EVALUATION_TYPE=url_match pnpm run evals")}
    
    
    ${chalk.cyan.bold("Mind2Web")} - Real-world web interaction tasks for evaluating web agents
    
      ${chalk.dim("Run:")} ${chalk.green("pnpm run evals")} ${chalk.cyan("name=")}${chalk.yellow("agent/onlineMind2Web")}
      
      ${chalk.dim("Or:")}  ${chalk.green("EVAL_DATASET=onlineMind2Web pnpm run evals")}
      
      ${chalk.gray("Environment Variables:")}
      
      EVAL_ONLINEMIND2WEB_LIMIT     max tasks to run (default: 25)
      EVAL_ONLINEMIND2WEB_SAMPLE    random sample count before limit
      
      ${chalk.dim("Example:")}
      
      ${chalk.green("EVAL_ONLINEMIND2WEB_SAMPLE=50 EVAL_ONLINEMIND2WEB_LIMIT=10 pnpm run evals name=agent/onlineMind2Web")}
  `;

  const envSection = dedent`
    ${chalk.magenta.underline("\nGlobal Environment Variables\n")}
      
      EVAL_ENV              target environment, overridable via ${chalk.cyan("env=")}
      
      EVAL_TRIAL_COUNT      number of trials, overridable via ${chalk.cyan("trials=")}
      
      EVAL_MAX_CONCURRENCY  parallel sessions, overridable via ${chalk.cyan("concurrency=")}
      
      EVAL_PROVIDER         LLM provider, overridable via ${chalk.cyan("provider=")}
      
      EVAL_MAX_K            global limit for all benchmarks (overrides individual limits)
      
      EVAL_DATASET          filter to specific benchmark, overridable via ${chalk.cyan("--dataset=")}
      
      USE_API               use Stagehand API, overridable via ${chalk.cyan("api=")}
      
      EVAL_MODELS           comma-separated list of models to use
      
      AGENT_EVAL_MAX_STEPS  max steps for agent tasks (default: 50)
  `;

  return `${header}\n\n${synopsis}\n\n${body}\n${examplesSection}\n${externalBenchmarksSection}\n${envSection}\n`;
}

const wantsHelp = rawArgs.some((a) => HELP_REGEX.test(a));
const wantsMan = rawArgs.some((a) => MAN_REGEX.test(a));

if (wantsHelp || wantsMan) {
  console.log(buildUsage(wantsMan));
  process.exit(0);
}

let filterByCategory: string | null = null;
let filterByEvalName: string | null = null;

if (parsedArgs.evalName) {
  filterByEvalName = parsedArgs.evalName;
}

if (!filterByEvalName && parsedArgs.leftover.length > 0) {
  if (parsedArgs.leftover[0].toLowerCase() === "category") {
    filterByCategory = parsedArgs.leftover[1];
    if (!filterByCategory) {
      console.error(chalk.red("Error: Category name not specified."));
      process.exit(1);
    }
    try {
      EvalCategorySchema.parse(filterByCategory);
    } catch {
      console.error(
        chalk.red(
          `Error: Invalid category "${filterByCategory}". Valid categories are: ${DEFAULT_EVAL_CATEGORIES.join(
            ", ",
          )}`,
        ),
      );
      process.exit(1);
    }
  } else {
    // If leftover[0] is not "category", interpret it as a task/eval name
    filterByEvalName = parsedArgs.leftover[0];
  }
}

if (parsedArgs.provider !== undefined) {
  process.env.EVAL_PROVIDER = parsedArgs.provider;
}

export {
  filterByCategory,
  filterByEvalName,
  DEFAULT_EVAL_CATEGORIES,
  parsedArgs,
};
