import { Eval } from "braintrust";
import fs from "fs";
import path from "path";
import process from "process";
import {
  EvalArgs,
  EvalCategory,
  EvalCategorySchema,
  EvalFunction,
  EvalInput,
  EvalResult,
  SummaryResult,
  Testcase,
} from "../types/evals";
import { AvailableModelSchema } from "../types/model";
import { EvalLogger, env } from "./utils";

const DEFAULT_EVAL_CATEGORIES = process.env.EVAL_CATEGORIES
  ? process.env.EVAL_CATEGORIES.split(",")
  : ["observe", "act", "combination", "extract", "experimental"];

const CATEGORIES: EvalCategory[] = DEFAULT_EVAL_CATEGORIES.map((category) => {
  if (!EvalCategorySchema.safeParse(category).success) {
    throw new Error(`Category ${category} is not a valid category`);
  }

  return category as EvalCategory;
});

const generateTasksAndCategories = (): {
  tasks: Record<
    string,
    Promise<{
      [name: string]: EvalFunction;
    }>
  >;
  taskCategories: Record<string, string>;
} => {
  const tasks: Record<
    string,
    Promise<{
      [name: string]: EvalFunction;
    }>
  > = {};
  const taskCategories: Record<string, string> = {};

  CATEGORIES.map((category) => {
    const categoryPath = path.join(__dirname, category);
    try {
      const files = fs.readdirSync(categoryPath);
      files.map((file) => {
        if (file.endsWith(".ts")) {
          const taskName = file.replace(".ts", "");
          const taskModule = import(`./${category}/${taskName}`) as Promise<{
            [name: string]: EvalFunction;
          }>;
          tasks[taskName] = taskModule;
          taskCategories[taskName] = category;
        }
      });
    } catch (error) {
      console.warn(`Warning: Category directory ${category} not found`);
      console.log(error);
    }
  });

  return { tasks, taskCategories };
};

const { tasks, taskCategories } = generateTasksAndCategories();

const args = process.argv.slice(2);
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
        `Error: Invalid category "${filterByCategory}". Valid categories are: ${CATEGORIES.join(
          ", ",
        )}`,
      );
      process.exit(1);
    }
  } else {
    filterByEvalName = args[0];
    if (!Object.keys(tasks).includes(filterByEvalName)) {
      console.error(`Error: Evaluation "${filterByEvalName}" does not exist.`);
      process.exit(1);
    }
  }
}

const DEFAULT_EVAL_MODELS = process.env.EVAL_MODELS
  ? process.env.EVAL_MODELS.split(",")
  : ["gpt-4o", "claude-3-5-sonnet-latest"];

const MODELS: AvailableModel[] = (
  filterByCategory === "experimental"
    ? DEFAULT_EVAL_MODELS
    : DEFAULT_EVAL_MODELS.filter(
        (model) => model !== "o1-mini" && model !== "o1-preview",
      )
).map((model) => {
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
    .filter((result) => result.output._success)
    .map((result) => ({
      eval: result.input.name,
      model: result.input.modelName,
      category: taskCategories[result.input.name],
    }));

  const failed = results
    .filter((result) => !result.output._success)
    .map((result) => ({
      eval: result.input.name,
      model: result.input.modelName,
      category: taskCategories[result.input.name],
    }));

  const categories: Record<string, number> = {};

  Object.values(taskCategories).forEach((category) => {
    const categoryResults = results.filter(
      (r) => taskCategories[r.input.name] === category,
    );
    const successCount = categoryResults.filter(
      (r) => r.output._success,
    ).length;
    categories[category] = Math.round(
      (successCount / categoryResults.length) * 100,
    );
  });

  const models: Record<string, number> = {};

  results.forEach((result) => {
    const model = result.input.modelName;
    if (!models[model]) {
      const modelResults = results.filter((r) => r.input.modelName === model);
      const successCount = modelResults.filter((r) => r.output._success).length;
      models[model] = Math.round((successCount / modelResults.length) * 100);
    }
  });

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
    Object.keys(tasks).map((test) => ({
      input: { name: test, modelName: model },
      name: test,
      tags: [model, test],
      metadata: {
        model,
        test,
      },
      expected: true,
    })),
  );

  if (filterByCategory) {
    allTestcases = allTestcases.filter(
      (testcase) => taskCategories[testcase.name] === filterByCategory,
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

  try {
    const evalResult = await Eval("stagehand", {
      experimentName,
      data: generateFilteredTestcases,
      task: async (input: {
        name: keyof typeof tasks;
        modelName: AvailableModel;
      }) => {
        const logger = new EvalLogger();
        try {
          const taskModule = await tasks[input.name];
          const taskFunction = taskModule[input.name];

          if (typeof taskFunction !== "function") {
            throw new Error(
              `Task function for ${input.name} is not a function`,
            );
          }
          const result = await taskFunction({
            modelName: input.modelName,
            logger,
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
