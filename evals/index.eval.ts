/**
 * This script orchestrates the running of evaluations against a set of tasks.
 * It uses Braintrust to run multiple testcases (each testcase representing a
 * given task-model combination) and then aggregates the results, producing
 * a summary of passes, failures, and categorized success rates.
 *
 * Overview:
 * - Reads a configuration file `evals.config.json` to determine what tasks (evaluations)
 *   are available and which categories they belong to.
 * - Supports filtering which tasks to run either by evaluation category or by specific task name.
 * - Supports multiple models, defaulting to certain sets of models depending on the category.
 * - Runs each selected task against each selected model in parallel, collecting results.
 * - Saves a summary of the evaluation results to `eval-summary.json`.
 */
import fs from "fs";
import path from "path";
import process from "process";
import {
  DEFAULT_EVAL_CATEGORIES,
  filterByCategory,
  filterByEvalName,
} from "./args";
import { generateExperimentName } from "./utils";
import { exactMatch, errorMatch } from "./scoring";
import { tasksByName, tasksConfig, getModelList } from "./taskConfig";
import { Eval, wrapAISDKModel, wrapOpenAI } from "braintrust";
import { SummaryResult, Testcase, EvalInput } from "@/types/evals";
import { EvalLogger } from "./logger";
import { AvailableModel, LLMClient } from "@browserbasehq/stagehand";
import { env } from "./env";
import dotenv from "dotenv";
import { StagehandEvalError } from "@/types/stagehandErrors";
import { CustomOpenAIClient } from "@/examples/external_clients/customOpenAI";
import OpenAI from "openai";
import { initStagehand } from "./initStagehand";
import { AISdkClient } from "@/examples/external_clients/aisdk";
import { getAISDKLanguageModel } from "@/lib/llm/LLMProvider";
import { loadApiKeyFromEnv } from "@/lib/utils";
import { LogLine } from "@/types/log";

dotenv.config();

/**
 * Read max concurrency and trial count from environment variables set in args.ts.
 * Fallback to defaults (20 and 5) if they're not provided.
 */
const MAX_CONCURRENCY = process.env.EVAL_MAX_CONCURRENCY
  ? parseInt(process.env.EVAL_MAX_CONCURRENCY, 10)
  : 3;

const TRIAL_COUNT = process.env.EVAL_TRIAL_COUNT
  ? parseInt(process.env.EVAL_TRIAL_COUNT, 10)
  : 3;

const USE_API: boolean = (process.env.USE_API ?? "").toLowerCase() === "true";

/**
 * generateSummary:
 * After all evaluations have finished, aggregate the results into a summary.
 * This summary includes:
 * - Which tasks passed or failed (with model and categories).
 * - Category-wise success percentages.
 * - Model-wise success percentages.
 *
 * The summary is written to `eval-summary.json` for further analysis.
 */
const generateSummary = async (
  results: SummaryResult[],
  experimentName: string,
) => {
  // Determine passed testcases (those with _success: true)
  const passed = results
    .filter((r) => r.output._success)
    .map((r) => ({
      eval: r.input.name,
      model: r.input.modelName,
      categories: tasksByName[r.input.name].categories,
    }));

  // Determine failed testcases (those with _success: false)
  const failed = results
    .filter((r) => !r.output._success)
    .map((r) => ({
      eval: r.input.name,
      model: r.input.modelName,
      categories: tasksByName[r.input.name].categories,
    }));

  // Calculate success counts for each category
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

  // Compute percentage success per category
  const categories: Record<string, number> = {};
  for (const [cat, counts] of Object.entries(categorySuccessCounts)) {
    categories[cat] = Math.round((counts.success / counts.total) * 100);
  }

  // Compute percentage success per model
  const models: Record<string, number> = {};
  const allModels = [...new Set(results.map((r) => r.input.modelName))];
  for (const model of allModels) {
    const modelResults = results.filter((r) => r.input.modelName === model);
    const successCount = modelResults.filter((r) => r.output._success).length;
    models[model] = Math.round((successCount / modelResults.length) * 100);
  }

  // Format and write the summary to a JSON file
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

/**
 * generateFilteredTestcases:
 * Based on the chosen filters (category or specific eval name) and environment,
 * this function generates the set of testcases to run. Each testcase is a combination
 * of a task and a model.
 *
 * Steps:
 * - Dynamically determine the list of models based on filters.
 * - Start with all combinations of tasks (from `tasksByName`) and the determined models.
 * - Filter by category if a category filter was specified.
 * - Filter by evaluation name if specified.
 * - In the BROWSERBASE environment, exclude certain tasks that are not suitable.
 */
const generateFilteredTestcases = (): Testcase[] => {
  let taskNamesToRun: string[];
  let effectiveCategory: string | null = filterByCategory; // Start with the command-line filter

  if (filterByEvalName) {
    // If a specific task name is given, that's the only one we run
    taskNamesToRun = [filterByEvalName];
    // Check if this single task belongs *only* to the agent category to override models
    const taskCategories = tasksByName[filterByEvalName]?.categories || [];
    if (taskCategories.length === 1 && taskCategories[0] === "agent") {
      // Treat this run as an 'agent' category run for model selection
      effectiveCategory = "agent";
      console.log(
        `Task ${filterByEvalName} is agent-specific, using agent models.`,
      );
    }
  } else if (filterByCategory) {
    // If filtering by category, get all tasks in that category
    taskNamesToRun = Object.keys(tasksByName).filter((name) =>
      tasksByName[name].categories.includes(filterByCategory!),
    );
  } else {
    // If no specific task or category filter, run tasks from default categories
    taskNamesToRun = Object.keys(tasksByName).filter((name) =>
      DEFAULT_EVAL_CATEGORIES.some((category) =>
        tasksByName[name].categories.includes(category),
      ),
    );
  }

  // Dynamically determine the MODELS based on the effective category
  const currentModels = getModelList(effectiveCategory);

  console.log(
    `Using models for this run (${effectiveCategory || "default"}):`,
    currentModels,
  );

  // Special handling: fan out GAIA (WebVoyager) dataset for agent/webarena_gaia
  const isGAIATaskIncluded = taskNamesToRun.includes("agent/webarena_gaia");
  // Special handling: fan out WebVoyager dataset for agent/webvoyager
  const isWebVoyagerTaskIncluded = taskNamesToRun.includes("agent/webvoyager");

  let allTestcases: Testcase[] = [];

  if (isGAIATaskIncluded) {
    // Remove the umbrella task to avoid creating a single placeholder testcase
    taskNamesToRun = taskNamesToRun.filter((t) => t !== "agent/webarena_gaia");

    // Load GAIA dataset from env or default path
    const gaiaFilePath = process.env.EVAL_GAIA_FILE ||
      path.join(__dirname, "..", "WebVoyager", "data", "GAIA_web.jsonl");

    let gaiaLines: string[] = [];
    try {
      const content = fs.readFileSync(gaiaFilePath, "utf-8");
      gaiaLines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
    } catch (e) {
      console.warn(
        `Could not read GAIA file at ${gaiaFilePath}. Set EVAL_GAIA_FILE to override. Error: ${e instanceof Error ? e.message : String(e)}`,
      );
      gaiaLines = [];
    }

    const levelFilter = process.env.EVAL_GAIA_LEVEL
      ? Number(process.env.EVAL_GAIA_LEVEL)
      : undefined;
    const maxCases = process.env.EVAL_GAIA_LIMIT
      ? Number(process.env.EVAL_GAIA_LIMIT)
      : 25;

    type GaiaRow = {
      id: string;
      Level?: number;
      web: string;
      ques: string;
      [key: string]: unknown;
    };

    const gaiaRows: GaiaRow[] = [];
    for (const line of gaiaLines) {
      try {
        const parsed = JSON.parse(line) as GaiaRow;
        if (typeof parsed.id === "string" && typeof parsed.web === "string" && typeof parsed.ques === "string") {
          if (!levelFilter || parsed.Level === levelFilter) {
            gaiaRows.push(parsed);
          }
        }
      } catch {
        // skip invalid lines
      }
      if (gaiaRows.length >= maxCases) break;
    }

    // Create fanned-out testcases for each model and row
    for (const model of currentModels) {
      for (const row of gaiaRows) {
        // Pull final answer if present (field name is "Final answer" in GAIA)
        const finalAnswer = (row as any)["Final answer"];

        const input: EvalInput = {
          name: "agent/webarena_gaia",
          modelName: model as AvailableModel,
          params: {
            id: row.id,
            level: row.Level,
            web: row.web,
            ques: row.ques,
            expected: typeof finalAnswer === "string" ? finalAnswer : undefined,
          },
        };
        allTestcases.push({
          input,
          name: input.name,
          tags: [
            model,
            input.name,
            ...(tasksConfig.find((t) => t.name === input.name)?.categories || []).map(
              (x) => `category/${x}`,
            ),
            `gaia/id/${row.id}`,
            row.Level ? `gaia/level/${row.Level}` : "gaia/level/unknown",
          ],
          metadata: {
            model: model as AvailableModel,
            test: `${input.name}:${row.id}`,
          },
          expected: true,
        });
      }
    }
  }

  if (isWebVoyagerTaskIncluded) {
    // Remove umbrella task to avoid a single placeholder testcase
    taskNamesToRun = taskNamesToRun.filter((t) => t !== "agent/webvoyager");

    // Read from local copied dataset under evals/datasets
    const voyagerFilePath = path.join(
      __dirname,
      "datasets",
      "webvoyager",
      "WebVoyager_data.jsonl",
    );

    let lines: string[] = [];
    try {
      const content = fs.readFileSync(voyagerFilePath, "utf-8");
      lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
    } catch (e) {
      console.warn(
        `Could not read WebVoyager file at ${voyagerFilePath}. Error: ${e instanceof Error ? e.message : String(e)}`,
      );
      lines = [];
    }

    const maxCases = process.env.EVAL_WEBVOYAGER_LIMIT
      ? Number(process.env.EVAL_WEBVOYAGER_LIMIT)
      : 25;

    type VoyagerRow = {
      id: string;
      web: string;
      ques: string;
      web_name?: string;
      [key: string]: unknown;
    };

    const rows: VoyagerRow[] = [];
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as VoyagerRow;
        if (typeof parsed.id === "string" && typeof parsed.web === "string" && typeof parsed.ques === "string") {
          rows.push(parsed);
        }
      } catch {
        // skip invalid
      }
      if (rows.length >= maxCases) break;
    }

    for (const model of currentModels) {
      for (const row of rows) {
        const input: EvalInput = {
          name: "agent/webvoyager",
          modelName: model as AvailableModel,
          params: {
            id: row.id,
            web: row.web,
            ques: row.ques,
            web_name: row.web_name,
          },
        };
        allTestcases.push({
          input,
          name: input.name,
          tags: [
            model,
            input.name,
            ...(tasksConfig.find((t) => t.name === input.name)?.categories || []).map(
              (x) => `category/${x}`,
            ),
            `webvoyager/id/${row.id}`,
          ],
          metadata: {
            model: model as AvailableModel,
            test: `${input.name}:${row.id}`,
          },
          expected: true,
        });
      }
    }
  }

  // Create a list of all remaining testcases using the determined task names and models
  const regularTestcases = currentModels.flatMap((model) =>
    taskNamesToRun.map((testName) => ({
      input: { name: testName, modelName: model as AvailableModel },
      name: testName,
      tags: [
        model,
        testName,
        ...(tasksConfig.find((t) => t.name === testName)?.categories || []).map(
          (x) => `category/${x}`,
        ),
      ],
      metadata: {
        model: model as AvailableModel,
        test: testName,
      },
      expected: true,
    })),
  );

  allTestcases = [...allTestcases, ...regularTestcases];

  // This filtering step might now be redundant if taskNamesToRun is already filtered
  if (filterByCategory) {
    allTestcases = allTestcases.filter((testcase) =>
      tasksByName[testcase.name].categories.includes(filterByCategory!),
    );
  }

  // If running in BROWSERBASE environment, exclude tasks that are not applicable.
  if (env === "BROWSERBASE") {
    allTestcases = allTestcases.filter(
      (testcase) => !["peeler_simple", "stock_x"].includes(testcase.name),
    );
  }

  console.log(
    "Final test cases to run:",
    allTestcases
      .map((t, i) => `${i}: ${t.name} (${t.input.modelName}): ${tasksByName[t.name].categories}`)
      .join("\n"),
  );

  return allTestcases;
};

/**
 * Main execution block:
 * - Determine experiment name
 * - Determine the project name (braintrustProjectName) based on CI or dev environment
 * - Run the Eval function with the given configuration:
 *    * experimentName: A label for this run
 *    * data: A function that returns the testcases to run
 *    * task: A function that executes each task, given input specifying model and task name
 *    * scores: An array of scoring functions
 *    * maxConcurrency: Limit on parallel tasks
 *    * trialCount: Number of trials (retries) per task
 * - Collect and summarize results using `generateSummary`.
 */
(async () => {
  // Generate a unique name for the experiment
  const experimentName: string = generateExperimentName({
    evalName: filterByEvalName || undefined,
    category: filterByCategory || undefined,
    environment: env,
  });

  // Determine braintrust project name to use (stagehand in CI, stagehand-dev otherwise)
  const braintrustProjectName =
    process.env.CI === "true" ? "stagehand" : "stagehand-dev";

  try {
    // Run the evaluations with the braintrust Eval function
    const evalResult = await Eval(braintrustProjectName, {
      experimentName,
      data: generateFilteredTestcases,
      // Each test is a function that runs the corresponding task module
      task: async (input: EvalInput) => {
        const logger = new EvalLogger();
        try {
          // Dynamically import the task based on its name
          const taskModulePath = path.join(
            __dirname,
            "tasks",
            `${input.name}.ts`,
          );

          // Check if file exists at direct path
          let taskModule;
          try {
            // First try to import directly (for backward compatibility)
            taskModule = await import(taskModulePath);
          } catch (error) {
            if (input.name.includes("/")) {
              // If the name includes a path separator, try to import from subdirectory
              const subDirPath = path.join(
                __dirname,
                "tasks",
                `${input.name}.ts`,
              );
              try {
                taskModule = await import(subDirPath);
              } catch (subError) {
                throw new StagehandEvalError(
                  `Failed to import task module for ${input.name}. Tried paths:\n` +
                    `- ${taskModulePath}\n` +
                    `- ${subDirPath}\n` +
                    `Error: ${subError.message}`,
                );
              }
            } else {
              throw new StagehandEvalError(
                `Failed to import task module for ${input.name} at path ${taskModulePath}: ${error.message}`,
              );
            }
          }

          // Extract the task function
          const taskName = input.name.includes("/")
            ? input.name.split("/").pop() // Get the last part of the path for nested tasks
            : input.name;

          const taskFunction = taskModule[taskName];

          if (typeof taskFunction !== "function") {
            throw new StagehandEvalError(
              `No Eval function found for task name: ${taskName} in module ${input.name}`,
            );
          }

          // Execute the task
          let taskInput: Awaited<ReturnType<typeof initStagehand>>;

          if (USE_API) {
            const [provider] = input.modelName.split("/") as [string, string];

            const logFn = (line: LogLine): void => logger.log(line);
            const apiKey = loadApiKeyFromEnv(provider, logFn);

            if (!apiKey) {
              throw new StagehandEvalError(
                `USE_API=true but no API key found for provider “${provider}”.`,
              );
            }

            taskInput = await initStagehand({
              logger,
              modelName: input.modelName,
              modelClientOptions: { apiKey: apiKey },
            });
          } else {
            let llmClient: LLMClient;
            if (input.modelName.includes("/")) {
              llmClient = new AISdkClient({
                model: wrapAISDKModel(
                  getAISDKLanguageModel(
                    input.modelName.split("/")[0],
                    input.modelName.split("/")[1],
                  ),
                ),
              });
            } else {
              llmClient = new CustomOpenAIClient({
                modelName: input.modelName as AvailableModel,
                client: wrapOpenAI(
                  new OpenAI({
                    apiKey: process.env.TOGETHER_AI_API_KEY,
                    baseURL: "https://api.together.xyz/v1",
                  }),
                ),
              });
            }
            taskInput = await initStagehand({
              logger,
              llmClient,
              modelName: input.modelName,
            });
          }
          // Attach per-test parameters (for data-driven tasks)
          (taskInput as any).taskParams = input.params;
          let result;
          try {
            result = await taskFunction(taskInput);
            // Log result to console
            if (result && result._success) {
              console.log(`✅ ${input.name}: Passed`);
            } else {
              console.log(`❌ ${input.name}: Failed`);
            }
          } finally {
            await taskInput.stagehand.close();
          }
          return result;
        } catch (error) {
          // Log any errors that occur during task execution
          console.error(`❌ ${input.name}: Error - ${error}`);
          logger.error({
            message: `Error in task ${input.name}`,
            level: 0,
            auxiliary: {
              error: {
                value: error.message,
                type: "string",
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
      // Use the scoring functions defined above
      scores: [exactMatch, errorMatch],
      maxConcurrency: MAX_CONCURRENCY,
      trialCount: TRIAL_COUNT,
    });

    // Map results to the SummaryResult format
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

    // Generate and write the summary
    await generateSummary(summaryResults, experimentName);
  } catch (error) {
    console.error("Error during evaluation run:", error);
    process.exit(1);
  }
})();
