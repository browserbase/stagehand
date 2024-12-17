import fs from "fs";
import path from "path";
import process from "process";
import { Eval } from "braintrust";
import {
  EvalArgs,
  EvalCategorySchema,
  EvalFunction,
  EvalInput,
  EvalResult,
  SummaryResult,
  Testcase,
} from "../types/evals";
import { AvailableModel, AvailableModelSchema } from "../types/model";
import { EvalLogger, env } from "./utils";

const args = process.argv.slice(2);

const configPath = path.join(__dirname, "evals.config.json");
const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));

const DEFAULT_EVAL_CATEGORIES = process.env.EVAL_CATEGORIES
  ? process.env.EVAL_CATEGORIES.split(",")
  : [
      "observe",
      "act",
      "combination",
      "extract",
      "experimental",
      "text_extract",
    ];

let extractMethod = "domExtract";
const extractMethodArg = args.find((arg) =>
  arg.startsWith("--extract-method="),
);
if (extractMethodArg) {
  extractMethod = extractMethodArg.split("=")[1];
}

process.env.EXTRACT_METHOD = extractMethod;
const useTextExtract = process.env.EXTRACT_METHOD === "textExtract";

let filterByCategory: string | null = null;
let filterByEvalName: string | null = null;

if (args.length > 0) {
  if (args[0].toLowerCase() === "category") {
    filterByCategory = args[1];
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
    filterByEvalName = args[0];
  }
}

type TaskConfig = { name: string; categories: string[] };
const tasksConfig = config.tasks as TaskConfig[];
const tasksByName = tasksConfig.reduce<
  Record<string, { categories: string[] }>
>((acc, task) => {
  acc[task.name] = { categories: task.categories };
  return acc;
}, {});

if (filterByEvalName && !tasksByName[filterByEvalName]) {
  console.error(`Error: Evaluation "${filterByEvalName}" does not exist.`);
  process.exit(1);
}

const DEFAULT_EVAL_MODELS = process.env.EVAL_MODELS
  ? process.env.EVAL_MODELS.split(",")
  : ["gpt-4o", "claude-3-5-sonnet-latest"];

const EXPERIMENTAL_EVAL_MODELS = process.env.EXPERIMENTAL_EVAL_MODELS
  ? process.env.EXPERIMENTAL_EVAL_MODELS.split(",")
  : ["o1-mini", "o1-preview"];

const getModelList = (category: string | null): string[] => {
  if (category === "experimental") {
    // to remove duplicates
    return Array.from(
      new Set([...DEFAULT_EVAL_MODELS, ...EXPERIMENTAL_EVAL_MODELS]),
    );
  }
  return DEFAULT_EVAL_MODELS;
};

const MODELS: AvailableModel[] = getModelList(filterByCategory).map((model) => {
  if (!AvailableModelSchema.safeParse(model).success) {
    throw new Error(`Model ${model} is not a supported model`);
  }
  return model as AvailableModel;
});

const generateTimestamp = (): string => {
  const now = new Date();
  return now
    .toISOString()
    .replace(/[-:TZ]/g, "")
    .slice(0, 14);
};

const generateExperimentName = ({
  evalName,
  category,
  environment,
}: {
  evalName?: string;
  category?: string;
  environment: string;
}): string => {
  const timestamp = generateTimestamp();
  if (evalName) {
    return `${evalName}_${environment.toLowerCase()}_${timestamp}`;
  }
  if (category) {
    return `${category}_${environment.toLowerCase()}_${timestamp}`;
  }
  return `all_${environment.toLowerCase()}_${timestamp}`;
};

const exactMatch = (
  args: EvalArgs<EvalInput, boolean | { _success: boolean }, unknown>,
): EvalResult => {
  console.log(`Task "${args.input.name}" returned: ${args.output}`);

  const expected = args.expected ?? true;
  if (expected === true) {
    return {
      name: "Exact match",
      score:
        typeof args.output === "boolean"
          ? args.output
            ? 1
            : 0
          : args.output._success
            ? 1
            : 0,
    };
  }

  return {
    name: "Exact match",
    score: args.output === expected ? 1 : 0,
  };
};

const errorMatch = (
  args: EvalArgs<
    EvalInput,
    boolean | { _success: boolean; error?: unknown },
    unknown
  >,
): EvalResult => {
  console.log(`Task "${args.input.name}" returned: ${args.output}`);

  return {
    name: "Error rate",
    score:
      typeof args.output === "object" && args.output.error !== undefined
        ? 1
        : 0,
  };
};

const generateSummary = async (
  results: SummaryResult[],
  experimentName: string,
) => {
  const passed = results
    .filter((r) => r.output._success)
    .map((r) => ({
      eval: r.input.name,
      model: r.input.modelName,
      categories: tasksByName[r.input.name].categories,
    }));

  const failed = results
    .filter((r) => !r.output._success)
    .map((r) => ({
      eval: r.input.name,
      model: r.input.modelName,
      categories: tasksByName[r.input.name].categories,
    }));

  const categorySuccessCounts: Record<
    string,
    { total: number; success: number }
  > = {};
  for (const taskName of Object.keys(tasksByName)) {
    const taskCategories = tasksByName[taskName].categories;
    const taskResults = results.filter((r) => r.input.name === taskName);
    const successCount = taskResults.filter((r) => r.output._success).length;

    for (const cat of taskCategories) {
      if (!categorySuccessCounts[cat]) {
        categorySuccessCounts[cat] = { total: 0, success: 0 };
      }
      categorySuccessCounts[cat].total += taskResults.length;
      categorySuccessCounts[cat].success += successCount;
    }
  }

  const categories: Record<string, number> = {};
  for (const [cat, counts] of Object.entries(categorySuccessCounts)) {
    categories[cat] = Math.round((counts.success / counts.total) * 100);
  }

  const models: Record<string, number> = {};
  const allModels = [...new Set(results.map((r) => r.input.modelName))];
  for (const model of allModels) {
    const modelResults = results.filter((r) => r.input.modelName === model);
    const successCount = modelResults.filter((r) => r.output._success).length;
    models[model] = Math.round((successCount / modelResults.length) * 100);
  }

  const formattedSummary = {
    experimentName,
    passed,
    failed,
    categories,
    models,
  };

  fs.writeFileSync(
    "eval-summary.json",
    JSON.stringify(formattedSummary, null, 2),
  );
  console.log("Evaluation summary written to eval-summary.json");
};

const generateFilteredTestcases = (): Testcase[] => {
  let allTestcases = MODELS.flatMap((model) =>
    Object.keys(tasksByName).map((testName) => ({
      input: { name: testName, modelName: model },
      name: testName,
      tags: [model, testName],
      metadata: {
        model,
        test: testName,
      },
      expected: true,
    })),
  );

  if (filterByCategory) {
    allTestcases = allTestcases.filter((testcase) =>
      tasksByName[testcase.name].categories.includes(filterByCategory!),
    );
  }

  if (filterByEvalName) {
    allTestcases = allTestcases.filter(
      (testcase) =>
        testcase.name === filterByEvalName ||
        testcase.input.name === filterByEvalName,
    );
  }

  if (env === "BROWSERBASE") {
    allTestcases = allTestcases.filter(
      (testcase) => !["peeler_simple", "stock_x"].includes(testcase.name),
    );
  }

  return allTestcases;
};

(async () => {
  const experimentName = generateExperimentName({
    evalName: filterByEvalName || undefined,
    category: filterByCategory || undefined,
    environment: env,
  });
  const braintrustProjectName =
    process.env.CI === "true" ? "stagehand" : "stagehand-dev";
  try {
    const evalResult = await Eval(braintrustProjectName, {
      experimentName,
      data: generateFilteredTestcases,
      task: async (input: { name: string; modelName: AvailableModel }) => {
        const logger = new EvalLogger();
        try {
          const taskModulePath = path.join(
            __dirname,
            "tasks",
            `${input.name}.ts`,
          );
          const taskModule = (await import(taskModulePath)) as {
            [key: string]: EvalFunction;
          };
          const taskFunction = taskModule[input.name];

          if (typeof taskFunction !== "function") {
            throw new Error(
              `Task function for ${input.name} is not a function`,
            );
          }
          const result = await taskFunction({
            modelName: input.modelName,
            logger,
            useTextExtract,
          });
          if (result && result._success) {
            console.log(`✅ ${input.name}: Passed`);
          } else {
            console.log(`❌ ${input.name}: Failed`);
          }
          return result;
        } catch (error) {
          console.error(`❌ ${input.name}: Error - ${error}`);
          logger.error({
            message: `Error in task ${input.name}`,
            level: 0,
            auxiliary: {
              error: {
                value: error.message,
                type: "object",
              },
              trace: {
                value: error.stack,
                type: "string",
              },
            },
          });
          return {
            _success: false,
            error: JSON.parse(JSON.stringify(error, null, 2)),
            logs: logger.getLogs(),
          };
        }
      },
      scores: [exactMatch, errorMatch],
      maxConcurrency: 20,
      trialCount: 5,
    });

    const summaryResults: SummaryResult[] = evalResult.results.map((result) => {
      const output =
        typeof result.output === "boolean"
          ? { _success: result.output }
          : result.output;

      return {
        input: result.input,
        output,
        name: result.input.name,
        score: output._success ? 1 : 0,
      };
    });

    await generateSummary(summaryResults, experimentName);
  } catch (error) {
    console.error("Error during evaluation run:", error);
    process.exit(1);
  }
})();
