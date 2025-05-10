import process from "process";
import { EvalCategorySchema } from "@/types/evals";

const rawArgs = process.argv.slice(2);

const parsedArgs: {
  evalName?: string;
  env?: string;
  trials?: number;
  concurrency?: number;
  extractMethod?: string;
  provider?: string;
  leftover: string[];
} = {
  leftover: [],
};

for (const arg of rawArgs) {
  if (arg.startsWith("env=")) {
    parsedArgs.env = arg.split("=")[1]?.toLowerCase();
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
  } else if (arg.startsWith("--extract-method=")) {
    parsedArgs.extractMethod = arg.split("=")[1];
  } else if (arg.startsWith("provider=")) {
    parsedArgs.provider = arg.split("=")[1]?.toLowerCase();
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

if (parsedArgs.trials !== undefined) {
  process.env.EVAL_TRIAL_COUNT = String(parsedArgs.trials);
}
if (parsedArgs.concurrency !== undefined) {
  process.env.EVAL_MAX_CONCURRENCY = String(parsedArgs.concurrency);
}

const extractMethod = parsedArgs.extractMethod || "domExtract";
process.env.EXTRACT_METHOD = extractMethod;

const useTextExtract = extractMethod === "textExtract";
const useAccessibilityTree = extractMethod === "accessibilityTree";

const DEFAULT_EVAL_CATEGORIES = process.env.EVAL_CATEGORIES
  ? process.env.EVAL_CATEGORIES.split(",")
  : [
      "observe",
      "act",
      "combination",
      "extract",
      "experimental",
      "text_extract",
      "targeted_extract",
      "regression_llm_providers",
      "regression",
      "llm_clients",
      "agent",
    ];

// Finally, interpret leftover arguments to see if user typed "category X" or a single eval name
let filterByCategory: string | null = null;
let filterByEvalName: string | null = null;

if (parsedArgs.evalName) {
  filterByEvalName = parsedArgs.evalName;
}

if (!filterByEvalName && parsedArgs.leftover.length > 0) {
  if (parsedArgs.leftover[0].toLowerCase() === "category") {
    filterByCategory = parsedArgs.leftover[1];
    if (!filterByCategory) {
      console.error("Error: Category name not specified.");
      process.exit(1);
    }
    try {
      EvalCategorySchema.parse(filterByCategory);
    } catch {
      console.error(
        `Error: Invalid category "${filterByCategory}". Valid categories are: ${DEFAULT_EVAL_CATEGORIES.join(", ")}`,
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
  useTextExtract,
  useAccessibilityTree,
  DEFAULT_EVAL_CATEGORIES,
  parsedArgs,
};
