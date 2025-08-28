import process from "process";
import { EvalCategorySchema } from "@/types/evals";
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

  const body = dedent`
    ${chalk.magenta.underline("Keys\n")}
  ${chalk.cyan("env".padEnd(12))} ${"target environment".padEnd(24)}
    (default ${chalk.dim("LOCAL")})                [${chalk.yellow("BROWSERBASE")}, ${chalk.yellow("LOCAL")}] ${chalk.gray("← LOCAL sets api=false")}

  ${chalk.cyan("api".padEnd(12))} ${"use the Stagehand API".padEnd(24)}
    (default ${chalk.dim("false")})                [${chalk.yellow("true")},  ${chalk.yellow("false")}]

  ${chalk.cyan("trials".padEnd(12))} ${"number of trials".padEnd(24)}
    (default ${chalk.dim("10")})

  ${chalk.cyan("concurrency".padEnd(12))} ${"max parallel sessions".padEnd(24)}
    (default ${chalk.dim("10")})

  ${chalk.cyan("provider".padEnd(12))} ${"override LLM provider".padEnd(24)}
    (default ${chalk.dim(providerDefault)})        [${chalk.yellow("OPENAI")}, ${chalk.yellow("ANTHROPIC")}, ${chalk.yellow("GOOGLE")}, ${chalk.yellow("TOGETHER")}, ${chalk.yellow("GROQ")}, ${chalk.yellow("CEREBRAS")}]

  ${chalk.cyan("max_k".padEnd(12))} ${"max test cases per dataset".padEnd(24)}
    (default ${chalk.dim("25")})

  ${chalk.cyan("--dataset".padEnd(12))} ${"filter dataset for benchmarks".padEnd(24)}
    (optional)              [${chalk.yellow("gaia")}, ${chalk.yellow("webvoyager")}]


    ${chalk.magenta.underline("Positional filters\n")}
      category <category_name>   one of: ${DEFAULT_EVAL_CATEGORIES.map((c) =>
        chalk.yellow(c),
      ).join(", ")}

      ${chalk.magenta.underline("\nExamples")}
      
      ${chalk.dim("# Run every evaluation locally with default settings")}
      
      ${chalk.green("pnpm run evals")}
      
      
      ${chalk.dim("# Same as above but in Browserbase with three trials")}
      
      ${chalk.green("pnpm run evals")} ${chalk.cyan("env=")}${chalk.yellow("BROWSERBASE")} ${chalk.cyan(
        "trials=",
      )}${chalk.yellow("3")}
      
      
      ${chalk.dim("# Run evals using the Stagehand API")}
      
      ${chalk.green("pnpm run evals")} ${chalk.cyan("env=")}${chalk.yellow("BROWSERBASE")} ${chalk.cyan(
        "api=",
      )}${chalk.yellow("true")}


      ${chalk.dim(
        "# Run evals from only the 'act' category with a max of 4 running at any given time",
      )}
      
      ${chalk.green("pnpm run evals")} ${chalk.cyan("category")} ${chalk.yellow("act")} ${chalk.cyan(
        "concurrency=",
      )}${chalk.yellow("4")}


      ${chalk.dim("# Execute a specific eval by filename")}
      
      ${chalk.green("pnpm run evals")} ${chalk.cyan("name=")}${chalk.yellow("my_eval_name")}
  `;

  if (!detailed)
    return `${header}\n\n${synopsis}\n\nFor more details: ${chalk.bold(
      "pnpm run evals -man\n",
    )}`;

  const envSection = dedent`
    ${chalk.magenta.underline("\nEnvironment variables\n")}
      EVAL_ENV              overridable via ${chalk.cyan("env=")}
      
      EVAL_TRIAL_COUNT      overridable via ${chalk.cyan("trials=")}
      
      EVAL_MAX_CONCURRENCY  overridable via ${chalk.cyan("concurrency=")}
      
      EVAL_PROVIDER         overridable via ${chalk.cyan("provider=")}
      
      USE_API               overridable via ${chalk.cyan("api=true")}
  `;

  return `${header}\n\n${synopsis}\n\n${body}\n${envSection}\n`;
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
