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
import {
  SummaryResult,
  Testcase,
  EvalInput,
  ErrorType,
  EvalOutput,
} from "@/types/evals";
import { EvalLogger } from "./logger";
import { AvailableModel, LLMClient } from "@browserbasehq/stagehand";
import { env } from "./env";
import dotenv from "dotenv";
import { StagehandEvalError } from "@/types/stagehandErrors";
import { CustomOpenAIClient } from "@/examples/external_clients/customOpenAI";
import OpenAI from "openai";
import { initStagehand } from "./initStagehand";
import { AgentProvider } from "@/lib/agent/AgentProvider";
import { AISdkClient } from "@/examples/external_clients/aisdk";
import { getAISDKLanguageModel } from "@/lib/llm/LLMProvider";
import { loadApiKeyFromEnv } from "@/lib/utils";
import { LogLine } from "@/types/log";
import { generateSummary } from "./core/summary";
import { buildGAIATestcases } from "./suites/gaia";
import { buildWebVoyagerTestcases } from "./suites/webvoyager";
import { buildOnlineMind2WebTestcases } from "./suites/onlineMind2Web";

dotenv.config();

process.on("uncaughtException", (err) => {
  console.error("[eval-runner] Uncaught exception:", err);
});

process.on("unhandledRejection", (reason) => {
  console.error("[eval-runner] Unhandled rejection:", reason);
});

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
    // Check if this single task belongs to agent-related categories to override models
    const taskCategories = tasksByName[filterByEvalName]?.categories || [];
    if (
      taskCategories.length === 1 &&
      (taskCategories[0] === "agent" ||
        taskCategories[0] === "external_agent_benchmarks")
    ) {
      // Treat this run as an agent category run for model selection
      effectiveCategory = taskCategories[0];
      console.log(
        `Task ${filterByEvalName} is in ${taskCategories[0]} category, using agent models.`,
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

  // Check for dataset filter from environment
  const datasetFilter = process.env.EVAL_DATASET;

  // Special handling: fan out GAIA dataset for agent/gaia
  const isGAIATaskIncluded = taskNamesToRun.includes("agent/gaia");
  // Special handling: fan out WebVoyager dataset for agent/webvoyager
  const isWebVoyagerTaskIncluded = taskNamesToRun.includes("agent/webvoyager");
  // Special handling: fan out Mind2Web dataset for agent/onlineMind2Web
  const isMind2WebTaskIncluded = taskNamesToRun.includes(
    "agent/onlineMind2Web",
  );

  let allTestcases: Testcase[] = [];

  // Only include GAIA if no dataset filter or if gaia is selected
  if (isGAIATaskIncluded && (!datasetFilter || datasetFilter === "gaia")) {
    taskNamesToRun = taskNamesToRun.filter((t) => t !== "agent/gaia");
    allTestcases.push(...buildGAIATestcases(currentModels));
  } else if (isGAIATaskIncluded && datasetFilter && datasetFilter !== "gaia") {
    // Remove GAIA from tasks to run if dataset filter excludes it
    taskNamesToRun = taskNamesToRun.filter((t) => t !== "agent/gaia");
  }

  // Only include WebVoyager if no dataset filter or if webvoyager is selected
  if (
    isWebVoyagerTaskIncluded &&
    (!datasetFilter || datasetFilter === "webvoyager")
  ) {
    taskNamesToRun = taskNamesToRun.filter((t) => t !== "agent/webvoyager");
    allTestcases.push(...buildWebVoyagerTestcases(currentModels));
  } else if (
    isWebVoyagerTaskIncluded &&
    datasetFilter &&
    datasetFilter !== "webvoyager"
  ) {
    // Remove WebVoyager from tasks to run if dataset filter excludes it
    taskNamesToRun = taskNamesToRun.filter((t) => t !== "agent/webvoyager");
  }

  // Only include Mind2Web if no dataset filter or if onlineMind2Web is selected
  if (
    isMind2WebTaskIncluded &&
    (!datasetFilter || datasetFilter === "onlineMind2Web")
  ) {
    taskNamesToRun = taskNamesToRun.filter((t) => t !== "agent/onlineMind2Web");
    allTestcases.push(...buildOnlineMind2WebTestcases(currentModels));
  } else if (
    isMind2WebTaskIncluded &&
    datasetFilter &&
    datasetFilter !== "onlineMind2Web"
  ) {
    // Remove Mind2Web from tasks to run if dataset filter excludes it
    taskNamesToRun = taskNamesToRun.filter((t) => t !== "agent/onlineMind2Web");
  }

  // Create a list of all remaining testcases using the determined task names and models
  const regularTestcases = currentModels.flatMap((model) =>
    taskNamesToRun.map((testName) => {
      const taskCategories =
        tasksConfig.find((t) => t.name === testName)?.categories || [];
      return {
        input: { name: testName, modelName: model as AvailableModel },
        name: testName,
        tags: [
          model,
          // Only include primary category as tag
          taskCategories.length > 0 ? taskCategories[0] : "uncategorized",
        ],
        metadata: {
          model: model as AvailableModel,
          test: testName,
          category: taskCategories[0],
          categories: taskCategories, // Keep all categories in metadata for filtering
        },
        expected: true,
      };
    }),
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
      .map(
        (t, i) =>
          `${i}: ${t.name} (${t.input.modelName}): ${tasksByName[t.name].categories}`,
      )
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

  const startTime = Date.now();

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
          const basePath = path.join(__dirname, "tasks", `${input.name}`);
          const candidatePaths = [`${basePath}.js`, `${basePath}.ts`];

          let taskModule;
          let lastError: unknown;
          for (const candidate of candidatePaths) {
            try {
              taskModule = await import(candidate);
              break;
            } catch (err) {
              lastError = err;
            }
          }

          if (!taskModule) {
            const tried = candidatePaths.join("\n- ");
            throw new StagehandEvalError(
              `Failed to import task module for ${input.name}. Tried paths:\n- ${tried}\nError: ${(lastError as Error)?.message}`,
            );
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
            // Derive provider from model. Prefer explicit "provider/model"; otherwise infer for agent models
            let provider: string;
            if (input.modelName.includes("/")) {
              provider = input.modelName.split("/")[0];
            } else {
              // Fall back to agent provider inference for bare agent model names (e.g., "computer-use-preview")
              try {
                provider = AgentProvider.getAgentProvider(input.modelName);
              } catch {
                // If not an agent model, leave provider undefined to trigger helpful error below
                provider = undefined as unknown as string;
              }
            }

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
          // Pass full EvalInput to the task (data-driven params available via input.params)
          let result;
          let isStagehandClosed = false;
          try {
            result = await taskFunction({ ...taskInput, input });
            // Log result to console
            if (result && result._success) {
              console.log(`✅ ${input.name}: Passed`);
            } else {
              console.log(`❌ ${input.name}: Failed`);
            }
          } finally {
            // Only close if not already closed
            if (taskInput.stagehand && !isStagehandClosed) {
              try {
                await taskInput.stagehand.close();
                isStagehandClosed = true;
              } catch (closeError) {
                console.warn("Error closing stagehand:", closeError);
              }
            }
          }
          return result;
        } catch (error) {
          // Categorize the error
          let errorType = ErrorType.UNKNOWN;
          const errorMessage =
            error instanceof Error ? error.message : String(error);

          const errorMessageLower = errorMessage.toLowerCase();

          if (error instanceof Error) {
            if (errorMessageLower.includes("access denied")) {
              errorType = ErrorType.ANTIBOT;
            } else if (errorMessageLower.includes("proxy.goto")) {
              errorType = ErrorType.PROXY_ERROR;
            } else if (errorMessageLower.includes("timeout")) {
              errorType = ErrorType.TIMEOUT;
            } else if (
              errorMessageLower.includes("network") ||
              errorMessageLower.includes("fetch")
            ) {
              errorType = ErrorType.NETWORK;
            } else if (
              errorMessageLower.includes("parse") ||
              errorMessageLower.includes("json")
            ) {
              errorType = ErrorType.PARSING_ERROR;
            } else if (
              errorMessageLower.includes("init") ||
              errorMessageLower.includes("setup")
            ) {
              errorType = ErrorType.SETUP_ERROR;
            }
          }

          // Log any errors that occur during task execution
          console.error(`❌ ${input.name}: ${errorType} - ${errorMessage}`);
          logger.error({
            message: `Error in task ${input.name}`,
            level: 0,
            auxiliary: {
              error: {
                value: errorMessage,
                type: "string",
              },
              error_type: {
                value: errorType,
                type: "string",
              },
              trace: {
                value: error instanceof Error ? error.stack : "",
                type: "string",
              },
            },
          });

          const output: EvalOutput = {
            _success: false,
            error: JSON.parse(JSON.stringify(error, null, 2)),
            error_type: errorType,
            error_message: errorMessage,
            error_stack: error instanceof Error ? error.stack : undefined,
            logs: logger.getLogs(),
            debugUrl: "",
            sessionUrl: "",
          };

          return output;
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
          : (result.output as EvalOutput);

      // The full output object (including error_type, error_message, etc.)
      // is already captured in result.output and will be visible in Braintrust
      // We don't need to duplicate it in metadata

      return {
        input: result.input,
        output,
        name: result.input.name,
        score: output._success ? 1 : 0,
      };
    });

    console.log(`\n⌛️ Total run time: ${(Date.now() - startTime) / 1000}s\n`);
    // Generate and write the summary
    await generateSummary(summaryResults, experimentName);
  } catch (error) {
    console.error("Error during evaluation run:", error);
    // process.exit(1);
  }
})();
