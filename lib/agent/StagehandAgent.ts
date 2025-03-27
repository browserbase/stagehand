import { LogLine } from "@/types/log";
import {
  AgentExecuteOptions,
  AgentResult,
  AgentExecutionOptions,
} from "@/types/agent";
import { AgentClient } from "./AgentClient";

/**
 * Main interface for agent operations in Stagehand
 * This class provides methods for executing tasks with an agent
 */
export class StagehandAgent {
  private client: AgentClient;
  private logger: (message: LogLine) => void;

  constructor(client: AgentClient, logger: (message: LogLine) => void) {
    this.client = client;
    this.logger = logger;
  }

  async execute(
    optionsOrInstruction: AgentExecuteOptions | string,
  ): Promise<AgentResult> {
    const options =
      typeof optionsOrInstruction === "string"
        ? { instruction: optionsOrInstruction }
        : optionsOrInstruction;

    this.logger({
      category: "agent",
      message: `Executing agent task: ${options.instruction}`,
      level: 1,
    });

    const executionOptions: AgentExecutionOptions = {
      options,
      logger: this.logger,
      retries: 3,
    };

    return await this.client.execute(executionOptions);
  }

  getModelName(): string {
    return this.client.modelName;
  }

  getAgentType(): string {
    return this.client.type;
  }
}
