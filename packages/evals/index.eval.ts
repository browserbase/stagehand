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
 * - Saves a summary of the evaluation results to `../../eval-summary.json`.
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import {
  DEFAULT_EVAL_CATEGORIES,
  filterByCategory,
  filterByEvalName,
} from "./args.js";
import { generateExperimentName } from "./utils.js";
import { exactMatch, errorMatch } from "./scoring.js";
import {
  tasksByName,
  tasksConfig,
  getModelList,
  getAgentModelEntries,
} from "./taskConfig.js";
import { Eval } from "braintrust";
import { SummaryResult, Testcase, EvalInput } from "./types/evals.js";
import { EvalLogger } from "./logger.js";
import {
  AvailableModel,
  LLMClient,
  StagehandEvalError,
  AgentProvider,
  loadApiKeyFromEnv,
  LogLine,
  getAISDKLanguageModel,
} from "@browserbasehq/stagehand";
import { AISdkClientWrapped } from "./lib/AISdkClientWrapped.js";
import { env } from "./env.js";
import { initV3 } from "./initV3.js";
import { generateSummary } from "./summary.js";
import { buildGAIATestcases } from "./suites/gaia.js";
import { buildWebVoyagerTestcases } from "./suites/webvoyager.js";
import { buildOnlineMind2WebTestcases } from "./suites/onlineMind2Web.js";
import { endBrowserbaseSession } from "./browserbaseCleanup.js";
import { buildWebTailBenchTestcases } from "./suites/webtailbench.js";
import { getCurrentDirPath } from "./runtimePaths.js";

import dotenv from "dotenv";
dotenv.config();

const moduleDir = getCurrentDirPath();

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
console.log(`[EVALS] USE_API: ${USE_API}`);

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

  // Special handling: fan out WebTailBench dataset for agent/webtailbench
  const isWebTailBenchTaskIncluded =
    taskNamesToRun.includes("agent/webtailbench");

  if (
    isWebTailBenchTaskIncluded &&
    (!datasetFilter || datasetFilter === "webtailbench")
  ) {
    taskNamesToRun = taskNamesToRun.filter((t) => t !== "agent/webtailbench");
    allTestcases.push(...buildWebTailBenchTestcases(currentModels));
  } else if (
    isWebTailBenchTaskIncluded &&
    datasetFilter &&
    datasetFilter !== "webtailbench"
  ) {
    taskNamesToRun = taskNamesToRun.filter((t) => t !== "agent/webtailbench");
  }

  // Create a list of all remaining testcases using the determined task names and models
  const isAgentCategory =
    effectiveCategory === "agent" ||
    effectiveCategory === "external_agent_benchmarks";

  // Use agent model entries (with cua flag) for agent categories, otherwise map currentModels
  const modelEntries = isAgentCategory
    ? getAgentModelEntries()
    : currentModels.map((m) => ({ modelName: m, cua: false }));

  const regularTestcases = modelEntries.flatMap((entry) =>
    taskNamesToRun.map((testName) => ({
      input: {
        name: testName,
        modelName: entry.modelName as AvailableModel,
        ...(isAgentCategory && { isCUA: entry.cua }),
      },
      name: testName,
      tags: [
        entry.modelName,
        ...(isAgentCategory ? [entry.cua ? "cua" : "agent"] : []),
        testName,
        ...(tasksConfig.find((t) => t.name === testName)?.categories || []).map(
          (x) => `category/${x}`,
        ),
      ],
      metadata: {
        model: entry.modelName as AvailableModel,
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

  try {
    // Run the evaluations with the braintrust Eval function
    const evalResult = await Eval(braintrustProjectName, {
      experimentName,
      data: generateFilteredTestcases,
      // Each test is a function that runs the corresponding task module
      task: async (input: EvalInput) => {
        const logger = new EvalLogger();
        // Track V3 instance at outer scope to ensure cleanup in all cases
        let v3Input: Awaited<ReturnType<typeof initV3>> | undefined;
        let v3ToClose: Awaited<ReturnType<typeof initV3>>["v3"] | null = null;

        try {
          const taskBasePath = path.join(moduleDir, "tasks", input.name);
          const taskCandidates = [`${taskBasePath}.js`, `${taskBasePath}.ts`];
          const taskModulePath = taskCandidates.find((candidate) =>
            fs.existsSync(candidate),
          );

          if (!taskModulePath) {
            throw new StagehandEvalError(
              `Failed to find task module for ${input.name}. Tried paths:\n` +
                taskCandidates.map((candidate) => `- ${candidate}`).join("\n"),
            );
          }

          const taskModule = await import(pathToFileURL(taskModulePath).href);

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
          const isAgentTask =
            input.name.startsWith("agent/") || input.name.includes("/agent/");
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

            // taskInput = await initStagehand({
            //   logger,
            //   modelName: input.modelName,
            //   modelClientOptions: { apiKey: apiKey },
            // });
            // Also initialize V3 so tasks can migrate to it progressively
            v3Input = await initV3({
              logger,
              modelName: input.modelName,
              modelClientOptions: { apiKey: apiKey },
              createAgent: isAgentTask,
              isCUA: input.isCUA,
            });
            v3ToClose = v3Input.v3;
          } else {
            let llmClient: LLMClient;
            if (input.modelName.includes("/")) {
              const firstSlashIndex = input.modelName.indexOf("/");
              llmClient = new AISdkClientWrapped({
                model: getAISDKLanguageModel(
                  input.modelName.substring(0, firstSlashIndex),
                  input.modelName.substring(firstSlashIndex + 1),
                ),
              });
            }
            v3Input = await initV3({
              logger,
              llmClient,
              modelName: input.modelName,
              createAgent: isAgentTask,
              isCUA: input.isCUA,
            });
            v3ToClose = v3Input.v3;
          }
          // Pass full EvalInput to the task (data-driven params available via input.params)
          const result = await taskFunction({ ...v3Input, input });

          // Log result to console
          if (result && result._success) {
            console.log(`✅ ${input.name}: Passed`);
          } else {
            console.log(`❌ ${input.name}: Failed`);
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
        } finally {
          // Always close V3 instance, regardless of success or failure.
          // This ensures proper cleanup even if the task threw an error or
          // the Browserbase session disconnected mid-execution.
          if (v3Input?.v3) {
            try {
              await v3Input.v3.close();
            } catch (closeError) {
              // Log but don't throw - we don't want close errors to mask
              // the original task result or prevent subsequent evals
              console.error(
                `Warning: Error closing V3 instance for ${input.name}:`,
                closeError,
              );
            }
          }
          await endBrowserbaseSession(v3ToClose);
          // Clear logger to free memory (logs already captured in result)
          logger.clear();
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
