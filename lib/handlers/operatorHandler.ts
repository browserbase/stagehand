/* eslint-disable */
import { AgentExecuteOptions, AgentResult } from "@/types/agent";
import { LogLine } from "@/types/log";
import {
  OperatorResponse,
  operatorResponseSchema,
  operatorSummarySchema,
} from "@/types/operator";
import { LLMClient } from "../llm/LLMClient";
import { PLANNER_PROMPT } from "../prompt";
import { StagehandPage } from "../StagehandPage";
import { StagehandError } from "@/types/stagehandErrors";
import { CoreMessage, LanguageModelV1 } from "ai";
import { LLMProvider } from "../llm/LLMProvider";
import { getAISDKLanguageModel } from "../llm/LLMProvider";
import { google } from "@ai-sdk/google";
import { z } from "zod";
import { WORKER_PROMPT } from "../prompt";

const PlannerLLM = google("gemini-2.5-flash-preview-04-17");
const WorkerLLM = google("gemini-2.0-flash");

export type TaskStatus = "PENDING" | "IN_PROGRESS" | "DONE" | "FAILED";

// Define the subtask interface
export interface Subtask {
  id: string;
  description: string;
  goal: string;
  dependencies?: string[]; // IDs of subtasks that must be completed before this one
  status: TaskStatus;
}

// Define the plan interface
export interface TaskPlan {
  summary: string;
  subtasks: Subtask[];
}

export interface TaskProgress {
  total: number;
  completed: number;
  failed: number;
  inProgress: number;
  pending: number;
}

// Define the step interface (similar to the existing Step type)
export interface BrowserStep {
  text: string;
  reasoning: string;
  tool: // | "GOTO"
  | "ACT"
    | "EXTRACT"
    | "OBSERVE"
    | "CLOSE"
    | "WAIT"
    | "NAVBACK"
    | "SCREENSHOT"
    | "DONE"
    | "FAIL"
    | "GET_URL";
  instruction: string;
  stepNumber?: number;
}

// Worker result interface
export interface WorkerResult {
  status: "DONE" | "FAILED";
  steps: BrowserStep[];
  extraction?: any;
  error?: string;
  retryCount: number;
}

export class StagehandOperatorHandler {
  private stagehandPage: StagehandPage;
  private readonly logger: (logLine: LogLine) => void;
  private llmClient: LLMClient;
  private llmProvider: LLMProvider;
  private messages: CoreMessage[];
  private model: LanguageModelV1 | LLMClient;
  private modelName: string;
  constructor(
    stagehandPage: StagehandPage,
    logger: (message: LogLine) => void,
    llmClient: LLMClient,
    llmProvider: LLMProvider,
    modelName: string,
  ) {
    this.stagehandPage = stagehandPage;
    this.logger = logger;
    this.llmClient = llmClient;
    this.llmProvider = llmProvider;
    this.modelName = modelName;
    const firstSlashIndex = this.modelName.indexOf("/");
    const subProvider = this.modelName.substring(0, firstSlashIndex);
    const subModelName = this.modelName.substring(firstSlashIndex + 1);

    const languageModel = getAISDKLanguageModel(
      subProvider,
      subModelName,
      this.llmClient.clientOptions?.apiKey,
    );
    this.model = languageModel;
  }

  public async plan(goal: string): Promise<TaskPlan> {
    // Generate a plan using the LLM
    // TODO add animation ...
    this.logger({
      category: "operator",
      message: `Generating plan`,
      level: 1,
    });
    const planResult = await this.llmClient.generateObject({
      model: PlannerLLM,
      schema: z.object({
        summary: z.string().describe("A summary of the overall task plan"),
        subtasks: z
          .array(
            z.object({
              description: z
                .string()
                .describe(
                  "A clear description of what this subtask should accomplish",
                ),
              goal: z
                .string()
                .describe("The specific goal this subtask aims to achieve"),
              dependencies: z
                .array(z.number())
                .optional()
                .describe(
                  "Array of subtask indices (0-based) that must be completed before this subtask can begin",
                ),
            }),
          )
          .min(1)
          .describe("An array of subtasks to accomplish the overall goal"),
      }),
      messages: [
        {
          role: "system",
          content: PLANNER_PROMPT,
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `I need a plan for accomplishing this task: "${goal}. You're currently on this page: ${this.stagehandPage.page.url()}"`,
            },
          ],
        },
      ],
    });
    const subtasks = planResult.object.subtasks.map((subtask, index) => ({
      id: `subtask-${index + 1}`,
      description: subtask.description,
      goal: subtask.goal,
      dependencies: subtask.dependencies?.map(
        (depIndex) => `subtask-${depIndex + 1}`,
      ),
      status: "PENDING" as const,
    }));

    const plan = {
      summary: planResult.object.summary,
      subtasks,
    };

    return plan;
  }

  public async executeSubtask(
    subtask: Subtask,
    overallGoal: string,
    taskPlanContext?: any,
  ): Promise<WorkerResult> {
    this.logger({
      category: "operator",
      message: `Executing subtask ${subtask.id}: ${subtask.goal}`,
      level: 1,
    });

    const MAX_STEPS = 15;
    const MAX_RETRIES = 3;
    const MAX_HISTORY = 5;

    let steps: BrowserStep[] = [];
    let extraction: any = null;
    let retryCount = 0;
    let lastError: Error | null = null;
    let currentScreenshot: string | null = null;
    let currentPageText: string | null = null;
    const recentActionHistory: Array<{ tool: string; instruction: string }> =
      [];
    let isSubtaskComplete = false;
    let currentUrl = "unknown";
    let previousExtraction: any = null; // Potentially pass this in if needed from dependencies

    try {
      // Get initial state
      currentUrl = this.stagehandPage.page.url() || "unknown";
      this.logger({
        category: "operator",
        message: `Starting URL: ${currentUrl}`,
        level: 2,
      });

      try {
        this.logger({
          category: "operator",
          message: `Capturing initial screenshot for subtask ${subtask.id}`,
          level: 2,
        });
        currentScreenshot = await this._performBrowserAction({
          text: "Capturing initial screenshot",
          reasoning: "Need visual context of starting state",
          tool: "SCREENSHOT",
          instruction: "",
        });
        this.logger({
          category: "operator",
          message: `Initial screenshot captured`,
          level: 2,
        });
        try {
          const textResult = await this.stagehandPage.page.extract();
          currentPageText = textResult.page_text;
          this.logger({
            category: "operator",
            message: `Extracted initial page text content`,
            level: 2,
          });
        } catch (textExtractError) {
          this.logger({
            category: "operator",
            message: `Failed to extract initial page text: ${textExtractError}`,
            level: 0,
          });
          currentPageText = null;
        }
      } catch (e) {
        this.logger({
          category: "operator",
          message: `Failed to capture initial screenshot: ${e}`,
          level: 0,
        });
        lastError = e instanceof Error ? e : new Error(String(e));
      }

      // Main execution loop
      while (
        !isSubtaskComplete &&
        steps.length < MAX_STEPS &&
        retryCount < MAX_RETRIES
      ) {
        try {
          const nextStep = await this._generateNextStepInstruction({
            subtaskId: subtask.id,
            overallGoal,
            subtaskGoal: subtask.goal,
            subtaskDescription: subtask.description,
            taskPlanContext, // Pass the context
            previousSteps: steps,
            currentUrl,
            previousExtraction,
            screenshot: currentScreenshot,
            currentPageText: currentPageText, // Pass textual content
          });

          this.logger({
            category: "operator",
            message: `[Subtask ${subtask.id}] Step ${steps.length + 1}: ${nextStep.tool} - ${nextStep.instruction.substring(0, 100)}${nextStep.instruction.length > 100 ? "..." : ""}`,
            level: 2,
          });

          // 2. Check for explicit DONE/FAIL
          if (nextStep.tool === "DONE") {
            this.logger({
              category: "operator",
              message: `Subtask ${subtask.id} marked DONE by agent: ${nextStep.instruction}`,
              level: 1,
            });
            steps.push(nextStep);
            return {
              status: "DONE",
              steps,
              extraction,
              retryCount,
            };
          }
          if (nextStep.tool === "FAIL") {
            this.logger({
              category: "operator",
              message: `Subtask ${subtask.id} marked FAIL by agent: ${nextStep.instruction}`,
              level: 0,
            });
            steps.push(nextStep);
            return {
              status: "FAILED",
              steps,
              error: nextStep.instruction,
              retryCount,
            };
          }

          // 3. Check for loops
          if (this._isRepeatingAction(nextStep, recentActionHistory)) {
            this.logger({
              category: "operator",
              message: `[Subtask ${subtask.id}] Detected potential loop on action: ${nextStep.tool}. Incrementing retry count.`,
              level: 0,
            });
            retryCount++;
            if (retryCount >= MAX_RETRIES) {
              throw new StagehandError(
                `Failed due to repeating action (${nextStep.tool}) ${retryCount} times.`,
              );
            }
            // TODO: Consider adding wait or alternative strategy before continuing
            this.logger({
              category: "operator",
              message: `Retrying (${retryCount}/${MAX_RETRIES})...`,
              level: 2,
            });
            // Capture fresh screenshot to potentially break loop
            try {
              currentScreenshot = await this._performBrowserAction({
                tool: "SCREENSHOT",
                instruction: "",
                text: "Refreshing screenshot for loop retry",
                reasoning: "Get updated visual context",
              });
            } catch (screenshotError) {
              this.logger({
                category: "operator",
                message: `Failed to capture fresh screenshot during loop retry: ${screenshotError}`,
                level: 0,
              });
            }
            await new Promise((resolve) => setTimeout(resolve, 1000)); // Wait before retry
            // ---> Also extract text content after loop retry screenshot
            try {
              const textResult = await this.stagehandPage.page.extract();
              currentPageText = textResult.page_text;
              this.logger({
                category: "operator",
                message: `Extracted page text content after loop retry screenshot`,
                level: 2,
              });
            } catch (textExtractError) {
              this.logger({
                category: "operator",
                message: `Failed to extract page text after loop retry screenshot: ${textExtractError}`,
                level: 0,
              });
              currentPageText = null;
            }
            continue;
          }

          // Add step to history *before* execution (to track attempts)
          steps.push(nextStep);

          // 4. Execute the browser step
          const result = await this._performBrowserAction(nextStep);
          lastError = null;

          // 5. Handle results/updates
          if (nextStep.tool === "EXTRACT") {
            extraction = result;
            previousExtraction = result;
            this.logger({
              category: "operator",
              message: `Extraction result: ${JSON.stringify(extraction)}`,
              level: 2,
            });
          }
          // if (nextStep.tool === "GOTO" || nextStep.tool === "NAVBACK") {
          if (nextStep.tool === "NAVBACK") {
            currentUrl = this.stagehandPage.page.url() || "unknown"; // Update URL after navigation
            this.logger({
              category: "operator",
              message: `URL updated to: ${currentUrl}`,
              level: 2,
            });
          }
          // Always get a new screenshot unless the action was a screenshot
          if (nextStep.tool !== "SCREENSHOT") {
            try {
              currentScreenshot = await this._performBrowserAction({
                tool: "SCREENSHOT",
                instruction: "",
                text: "Capturing screenshot after action",
                reasoning: "Get updated visual context",
              });
              this.logger({
                category: "operator",
                message: `Captured screenshot after ${nextStep.tool}`,
                level: 2,
              });
              try {
                const textResult = await this.stagehandPage.page.extract();
                currentPageText = textResult.page_text;
                this.logger({
                  category: "operator",
                  message: `Extracted page text content after ${nextStep.tool}`,
                  level: 2,
                });
              } catch (textExtractError) {
                this.logger({
                  category: "operator",
                  message: `Failed to extract page text after ${nextStep.tool}: ${textExtractError}`,
                  level: 0,
                });
                currentPageText = null;
              }
            } catch (screenshotError) {
              this.logger({
                category: "operator",
                message: `Failed to capture screenshot after ${nextStep.tool}: ${screenshotError}`,
                level: 0,
              });
            }
          } else {
            currentScreenshot = result as string; // Use the result of the screenshot action
            this.logger({
              category: "operator",
              message: `Updated screenshot from SCREENSHOT action`,
              level: 2,
            });
            try {
              const textResult = await this.stagehandPage.page.extract();
              currentPageText = textResult.page_text;
              this.logger({
                category: "operator",
                message: `Extracted page text content after SCREENSHOT action`,
                level: 2,
              });
            } catch (textExtractError) {
              this.logger({
                category: "operator",
                message: `Failed to extract page text after SCREENSHOT action: ${textExtractError}`,
                level: 0,
              });
              currentPageText = null;
            }
          }

          // TODO: Add logic to determine if subtask is implicitly complete based on state/result?
          // isSubtaskComplete = ...
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));
          this.logger({
            category: "operator",
            message: `[Subtask ${subtask.id}] Error executing step ${steps.length}: ${lastError.message}`,
            level: 0,
          });
          retryCount++;

          if (retryCount >= MAX_RETRIES) {
            this.logger({
              category: "operator",
              message: `[Subtask ${subtask.id}] Failed after ${retryCount} retries.`,
              level: 0,
            });
            // Add final FAIL step
            steps.push({
              text: "Marking subtask failed",
              reasoning: "Exceeded max retries",
              tool: "FAIL",
              instruction: lastError.message,
            });
            return {
              status: "FAILED",
              steps,
              error: lastError.message,
              retryCount,
            };
          }

          this.logger({
            category: "operator",
            message: `Retrying (${retryCount}/${MAX_RETRIES})...`,
            level: 2,
          });
          // Capture screenshot before retry
          try {
            currentScreenshot = await this._performBrowserAction({
              tool: "SCREENSHOT",
              instruction: "",
              text: "Capturing screenshot for error retry",
              reasoning: "Get updated visual context",
            });
          } catch (screenshotError) {
            this.logger({
              category: "operator",
              message: `Failed to capture screenshot during error retry: ${screenshotError}`,
              level: 0,
            });
          }
          await new Promise((resolve) => setTimeout(resolve, 1000)); // Wait before retry
          try {
            const textResult = await this.stagehandPage.page.extract();
            currentPageText = textResult.page_text;
            this.logger({
              category: "operator",
              message: `Extracted page text content after error retry screenshot`,
              level: 2,
            });
          } catch (textExtractError) {
            this.logger({
              category: "operator",
              message: `Failed to extract page text after error retry screenshot: ${textExtractError}`,
              level: 0,
            });
            currentPageText = null;
          }
        }
      }

      // Loop finished - Determine final status
      if (isSubtaskComplete) {
        // It should have returned earlier via DONE tool, but as a fallback
        this.logger({
          category: "operator",
          message: `[Subtask ${subtask.id}] Completed successfully (end of loop).`,
          level: 1,
        });
        if (steps[steps.length - 1]?.tool !== "DONE") {
          steps.push({
            text: "Marking subtask complete",
            reasoning: "Reached end of execution loop successfully",
            tool: "DONE",
            instruction: "Subtask completed",
          });
        }
        return { status: "DONE", steps, extraction, retryCount };
      } else if (steps.length >= MAX_STEPS) {
        this.logger({
          category: "operator",
          message: `[Subtask ${subtask.id}] Failed due to exceeding max steps (${MAX_STEPS}).`,
          level: 0,
        });
        if (steps[steps.length - 1]?.tool !== "FAIL") {
          steps.push({
            text: "Marking subtask failed",
            reasoning: "Exceeded max steps",
            tool: "FAIL",
            instruction: `Reached step limit (${MAX_STEPS})`,
          });
        }
        return {
          status: "FAILED",
          steps,
          error: `Exceeded maximum steps (${MAX_STEPS})`,
          retryCount,
        };
      } else {
        // Loop ended due to retries, should have been handled in catch block
        this.logger({
          category: "operator",
          message: `[Subtask ${subtask.id}] Loop ended unexpectedly. Assuming failure.`,
          level: 0,
        });
        if (steps[steps.length - 1]?.tool !== "FAIL") {
          steps.push({
            text: "Marking subtask failed",
            reasoning: "Execution loop ended unexpectedly after retries",
            tool: "FAIL",
            instruction: lastError?.message ?? "Unknown error after retries",
          });
        }
        return {
          status: "FAILED",
          steps,
          error: lastError?.message ?? "Unknown error after retries",
          retryCount,
        };
      }
    } catch (fatalError) {
      // Catch errors during initial setup or other unexpected fatal issues
      lastError =
        fatalError instanceof Error
          ? fatalError
          : new Error(String(fatalError));
      this.logger({
        category: "operator",
        message: `[Subtask ${subtask.id}] Fatal error during execution: ${lastError.message}`,
        level: 0,
      });
      if (steps[steps.length - 1]?.tool !== "FAIL") {
        steps.push({
          text: "Marking subtask failed",
          reasoning: "Fatal error during execution",
          tool: "FAIL",
          instruction: lastError.message,
        });
      }
      return {
        status: "FAILED",
        steps,
        error: lastError.message,
        retryCount,
      };
    }
  }

  public async execute(
    instructionOrOptions: string | AgentExecuteOptions,
  ): Promise<AgentResult> {
    const options =
      typeof instructionOrOptions === "string"
        ? { instruction: instructionOrOptions }
        : instructionOrOptions;

    this.logger({
      category: "operator",
      message: `Starting task execution for: '${options.instruction}'`,
      level: 1,
    });

    // 1. Generate the plan
    let plan: TaskPlan;
    try {
      plan = await this.plan(options.instruction);
      this.logger({
        category: "operator",
        message: `Generated plan: ${JSON.stringify(plan, null, 2)}`,
        level: 2, // Debug level for full plan
      });
    } catch (error) {
      this.logger({
        category: "operator",
        message: `Failed to generate plan: ${error}`,
        level: 0,
      });
      return {
        success: false,
        message: `Failed to generate plan: ${error instanceof Error ? error.message : String(error)}`,
        actions: [],
        completed: false,
      };
    }

    // 2. Execute subtasks sequentially (basic implementation)
    let overallSuccess = true;
    let finalMessage = `Task execution initiated for: ${options.instruction}`;
    const executedSubtaskResults: {
      subtaskId: string;
      result: WorkerResult;
    }[] = [];
    // Simple state for passing extractions (can be made more robust)
    let lastExtractionResult: any = null;

    for (const subtask of plan.subtasks) {
      // TODO: Implement dependency checking here if needed
      // For now, execute sequentially
      if (subtask.status !== "PENDING") {
        this.logger({
          category: "operator",
          message: `Skipping subtask ${subtask.id} with status ${subtask.status}`,
          level: 1,
        });
        continue;
      }

      this.logger({
        category: "operator",
        message: `Executing subtask ${subtask.id}: ${subtask.goal}`,
        level: 1,
      });
      subtask.status = "IN_PROGRESS";

      // Prepare context (can be expanded)
      const taskPlanContext = {
        planDescription: plan.summary,
        // TODO: Add position, total, other subtasks if needed by prompt
      };

      try {
        // Pass previous extraction result if available
        const subtaskResult = await this.executeSubtask(
          subtask,
          options.instruction,
          taskPlanContext /*, lastExtractionResult */,
        ); // Pass extraction if implementing state transfer
        executedSubtaskResults.push({
          subtaskId: subtask.id,
          result: subtaskResult,
        });

        if (subtaskResult.status === "DONE") {
          subtask.status = "DONE";
          this.logger({
            category: "operator",
            message: `Subtask ${subtask.id} completed successfully.`,
            level: 1,
          });
          // Update last extraction result if present
          if (subtaskResult.extraction) {
            lastExtractionResult = subtaskResult.extraction;
          }
        } else {
          // status === "FAILED"
          subtask.status = "FAILED";
          overallSuccess = false;
          finalMessage = `Task failed during subtask ${subtask.id}: ${subtaskResult.error || "Unknown error"}`;
          this.logger({
            category: "operator",
            message: `Subtask ${subtask.id} failed: ${subtaskResult.error}`,
            level: 0,
          });
          // Optional: Stop execution on first failure
          this.logger({
            category: "operator",
            message: `Stopping task execution due to subtask failure.`,
            level: 0,
          });
          break;
        }
      } catch (error) {
        subtask.status = "FAILED";
        overallSuccess = false;
        finalMessage = `Task failed during subtask ${subtask.id} execution: ${error instanceof Error ? error.message : String(error)}`;
        this.logger({
          category: "operator",
          message: `Fatal error during subtask ${subtask.id} execution: ${error}`,
          level: 0,
        });
        // Stop execution on fatal error
        break;
      }
    }

    // 3. Determine final result
    if (overallSuccess) {
      const allDone = plan.subtasks.every((st) => st.status === "DONE");
      if (allDone) {
        finalMessage = `Task completed successfully: ${plan.summary}`;
        this.logger({
          category: "operator",
          message: `All subtasks completed successfully.`,
          level: 1,
        });
      } else {
        finalMessage = `Task finished, but some subtasks may not have run or completed.`;
        this.logger({
          category: "operator",
          message: `Task finished, but not all subtasks reached DONE status.`,
          level: 1,
        });
        overallSuccess = false; // Mark as not fully successful if not all are DONE
      }
    }

    // Adapt the AgentResult structure - actions might represent subtask results now
    // For now, return a simplified actions array or potentially the detailed results.
    // Let's return the summary message for now.
    return {
      success: overallSuccess,
      message: finalMessage,
      // actions: executedSubtaskResults, // Or adapt AgentAction type
      actions: [], // Placeholder - requires defining how subtask results map to AgentAction
      completed: overallSuccess, // Assuming overallSuccess implies completion for now
      // Potentially add final extraction result here
      // extraction: lastExtractionResult
    };
  }

  private async _performBrowserAction(step: BrowserStep): Promise<any> {
    this.logger({
      category: "operator",
      message: `[Subtask ${step.stepNumber}] Executing: ${step.tool} - ${step.instruction.substring(0, 100)}`,
      level: 1,
    }); // Added logging
    const page = this.stagehandPage.page;

    switch (step.tool) {
      // case "GOTO":
      //   await page.goto(step.instruction, {
      //     waitUntil: "commit", // Match original code
      //     timeout: 60000, // Match original code
      //   });
      //   // Ensure DOM settles after navigation
      //   await this.stagehandPage._waitForSettledDom();
      //   return null; // No specific result for GOTO

      case "ACT":
        // Pass instruction string directly, remove unsupported slowDomBasedAct
        const actResult = await page.act(step.instruction);
        await this.stagehandPage._waitForSettledDom();
        return actResult; // Return the result of the ACT action

      case "EXTRACT": {
        this.logger({
          category: "operator",
          message: `Extracting: ${step.instruction}`,
          level: 2,
        });
        // Assuming extract returns an object with an extraction property based on original code
        const result = await page.extract(step.instruction);
        // Check if result has extraction property, otherwise return the whole result
        return result && typeof result === "object" && "extraction" in result
          ? result.extraction
          : result;
      }

      case "OBSERVE":
        this.logger({
          category: "operator",
          message: `Observing: ${step.instruction || "(no instruction)"}`,
          level: 2,
        });
        return await page.observe({ instruction: step.instruction });

      case "SCREENSHOT": {
        this.logger({
          category: "operator",
          message: `Taking screenshot`,
          level: 2,
        });
        const cdpSession = await page.context().newCDPSession(page);
        try {
          const { data } = await cdpSession.send("Page.captureScreenshot", {
            format: "png",
          }); // Specify format like png
          return `data:image/png;base64,${data}`; // Return base64 data URL
        } finally {
          await cdpSession.detach(); // Ensure session is detached
        }
      }

      case "WAIT":
        this.logger({
          category: "operator",
          message: `Waiting for ${step.instruction}ms`,
          level: 2,
        });
        await page.waitForTimeout(Number(step.instruction));
        return null;

      case "NAVBACK":
        this.logger({
          category: "operator",
          message: `Navigating back`,
          level: 2,
        });
        await page.goBack();
        await this.stagehandPage._waitForSettledDom();
        return null;

      case "GET_URL":
        this.logger({
          category: "operator",
          message: `Getting current URL`,
          level: 2,
        });
        return await page.url();

      case "DONE":
      case "FAIL":
        // These are terminal states, handled by the main loop based on the step received
        // No browser action needed here, but we return the status info
        this.logger({
          category: "operator",
          message: `Step is terminal: ${step.tool}`,
          level: 1,
        });
        return { status: step.tool, message: step.instruction };

      // CLOSE is deprecated and converted to DONE by _generateNextStepInstruction
      // case "CLOSE":

      default:
        // Use StagehandError for consistency
        throw new StagehandError(
          `[OperatorHandler] _performBrowserAction: Unimplemented or unknown tool ${step.tool}`,
        );
    }
  }

  private _isRepeatingAction(
    step: BrowserStep,
    history: Array<{ tool: string; instruction: string }>,
  ): boolean {
    // TODO: Implement logic from the provided code
    console.log("[OperatorHandler] TODO: Implement _isRepeatingAction logic");
    const MAX_HISTORY = 5; // Number of actions to track
    const MAX_DUPLICATES = 2; // Maximum number of times the same action can be repeated

    const duplicate = history.filter(
      (h) => h.tool === step.tool && h.instruction === step.instruction,
    ).length;

    // Add current action to history (mutable operation, careful if history is shared)
    history.push({
      tool: step.tool,
      instruction: step.instruction,
    });

    // Keep history at MAX_HISTORY size
    if (history.length > MAX_HISTORY) {
      history.shift();
    }

    return duplicate >= MAX_DUPLICATES;
  }

  private _hasPossibleLoop(steps: BrowserStep[]): boolean {
    // TODO: Implement logic from the provided code
    console.log("[OperatorHandler] TODO: Implement _hasPossibleLoop logic");
    if (steps.length < 3) return false;

    const recentSteps = steps.slice(-3);
    const allSameTool = recentSteps.every(
      (s) => s.tool === recentSteps[0].tool,
    );
    const uniqueInstructions = new Set(recentSteps.map((s) => s.instruction));
    const hasRepeatedInstructions =
      uniqueInstructions.size < recentSteps.length;
    const stuckPhrases = [
      "still",
      "again",
      "retry",
      "same",
      "another attempt",
      "try once more",
    ];
    const containsStuckPhrases = recentSteps.some((s) =>
      stuckPhrases.some(
        (phrase) =>
          s.text.toLowerCase().includes(phrase) ||
          s.reasoning.toLowerCase().includes(phrase),
      ),
    );

    return (allSameTool && hasRepeatedInstructions) || containsStuckPhrases;
  }

  private async _generateNextStepInstruction(params: {
    subtaskId: string;
    overallGoal: string;
    subtaskGoal: string;
    subtaskDescription: string;
    taskPlanContext: any; // Define specific type later
    previousSteps: BrowserStep[];
    currentUrl: string;
    previousExtraction: any;
    screenshot: string | null;
    currentPageText: string | null;
  }): Promise<BrowserStep> {
    const {
      subtaskId,
      overallGoal,
      subtaskGoal,
      subtaskDescription,
      taskPlanContext, // Assuming this might contain planDescription, subtaskPosition, totalSubtasks, otherSubtasks
      previousSteps,
      currentUrl,
      previousExtraction,
      screenshot,
      currentPageText,
    } = params;

    this.logger({
      category: "operator",
      message: `[Subtask ${subtaskId}] Generating next step instruction.`,
      level: 2,
    });

    // Define the schema for the LLM response
    const browserStepSchema = z.object({
      text: z
        .string()
        .describe("A concise description of what action to take next"),
      reasoning: z
        .string()
        .describe(
          "Your reasoning for choosing this action, referring specifically to what you observe in the screenshot and how it relates to the overall task",
        ),
      tool: z
        .enum([
          // "GOTO",
          "ACT",
          "EXTRACT",
          "OBSERVE",
          "CLOSE",
          "WAIT",
          "NAVBACK",
          "SCREENSHOT",
          "GET_URL",
          "DONE",
          "FAIL",
        ])
        .describe(
          "The tool to use for this step (CLOSE is deprecated, use DONE)",
        ),
      instruction: z
        .string()
        .describe("The specific instruction for the selected tool"),
    });

    // Construct the text prompt dynamically
    let textPrompt = `
OVERALL TASK GOAL: ${overallGoal}
`;
    // Add Task Plan context if available (adapt based on actual structure of taskPlanContext)
    if (taskPlanContext) {
      if (taskPlanContext.planDescription) {
        textPrompt += `PLAN DESCRIPTION: ${taskPlanContext.planDescription}\n`;
      }
      textPrompt += `YOUR SUBTASK GOAL: ${subtaskGoal}\n`;
      textPrompt += `SUBTASK DESCRIPTION: ${subtaskDescription}\n`;
      if (taskPlanContext.subtaskPosition) {
        textPrompt += `YOUR SUBTASK POSITION: ${taskPlanContext.subtaskPosition} of ${taskPlanContext.totalSubtasks || "?"}\n`;
      }
      // TODO: Add info about other subtasks if needed/available in taskPlanContext
      textPrompt += `\nHOW THIS SUBTASK FITS INTO THE OVERALL PLAN:
This subtask is one part of achieving the overall goal. Your work will contribute to the larger task.
`;
    }

    if (previousSteps.length > 0) {
      textPrompt += `\nPREVIOUS STEPS YOU\'VE TAKEN:
${previousSteps.map((step, i) => `Step ${i + 1}: ${step.text}\nTool: ${step.tool}\nInstruction: ${step.instruction}\nReasoning: ${step.reasoning}`).join("\n\n")}\n`;
    }
    if (previousExtraction) {
      textPrompt += `\nPREVIOUS EXTRACTION:
${JSON.stringify(previousExtraction, null, 2)}\n`;
    }
    textPrompt += `\nCURRENT URL: ${currentUrl}\n`;

    // Add textual page content if available
    if (currentPageText) {
      textPrompt += `\nCURRENT PAGE TEXT CONTENT (extracted). This is a DOM+Accessibility tree hybrid representation of the page:
-------
${currentPageText}
-------\n`; // Limit length to avoid excessive tokens
    }

    // Add loop warning if needed
    if (this._hasPossibleLoop(previousSteps)) {
      textPrompt += `\nWARNING: You appear to be repeating similar actions without making progress. Try a completely different approach to achieve your goal. Consider:
1. Using a different tool (e.g., ACT instead of OBSERVE)
2. Looking at different parts of the page in the screenshot
3. Trying a different interaction method (e.g., different selector or action)
4. Navigating to a different page if options are exhausted here\n`;
    }

    textPrompt += `
Determine the next single step to achieve the subtask goal. Carefully analyze the provided screenshot AND the textual page content.
Respond ONLY with the JSON object matching the required schema.`;

    try {
      const messages: CoreMessage[] = [
        { role: "system", content: WORKER_PROMPT },
        {
          role: "user",
          content: [
            { type: "text", text: textPrompt },
            // Add screenshot if available
            ...(screenshot
              ? [{ type: "image" as const, image: screenshot }]
              : []),
          ],
        },
      ];

      const result = await this.llmClient.generateObject({
        model: WorkerLLM, // Use the defined WorkerLLM
        messages,
        schema: browserStepSchema,
      });

      let nextStep: BrowserStep = result.object as BrowserStep;

      // If the LLM used the deprecated CLOSE tool, convert it to DONE
      if (nextStep.tool === "CLOSE") {
        this.logger({
          category: "operator",
          message: `[Subtask ${subtaskId}] LLM used deprecated CLOSE tool, converting to DONE.`,
          level: 1,
        });
        nextStep = {
          ...nextStep,
          tool: "DONE",
          text: nextStep.text.replace("Closing", "Completing"),
          instruction: `Subtask assumed complete based on CLOSE attempt: ${nextStep.instruction || nextStep.text}`,
        };
      }

      // Check for implicit completion signals even if DONE tool wasn't used
      if (
        nextStep.tool !== "DONE" &&
        nextStep.tool !== "FAIL" && // Don't override explicit FAIL
        (nextStep.text.toLowerCase().includes("task complete") ||
          nextStep.text.toLowerCase().includes("goal achieved") ||
          nextStep.text.toLowerCase().includes("subtask complete") ||
          nextStep.reasoning.toLowerCase().includes("task complete") ||
          nextStep.reasoning.toLowerCase().includes("goal achieved") ||
          nextStep.reasoning.toLowerCase().includes("subtask complete"))
      ) {
        this.logger({
          category: "operator",
          message: `[Subtask ${subtaskId}] Detected completion language but no DONE tool, converting step to DONE.`,
          level: 1,
        });
        return {
          ...nextStep, // Keep original reasoning/text for context
          tool: "DONE" as const,
          instruction: `Subtask implicitly completed: ${nextStep.instruction || nextStep.text}`,
        };
      }

      return nextStep;
    } catch (error) {
      this.logger({
        category: "operator",
        message: `[Subtask ${subtaskId}] Error generating next step instruction: ${error}`,
        level: 0,
      });
      // Fallback to a safe action if generation fails
      return {
        text: "Failed to determine next step, taking a screenshot to reassess",
        reasoning: `Error occurred in step generation: ${error instanceof Error ? error.message : String(error)}. Capturing current state to recover.`,
        tool: "SCREENSHOT",
        instruction: "",
      };
    }
  }
}
