import { AgentType } from "@/types/agent";

/**
 * Base class for AI SDK clients that doesn't require legacy agent methods
 * This provides a cleaner base for AI SDK implementations
 */
export abstract class AISDKBaseClient {
  protected type: AgentType;
  protected modelName: string;
  protected userProvidedInstructions?: string;
  protected clientOptions?: Record<string, unknown>;

  constructor(
    type: AgentType,
    modelName: string,
    userProvidedInstructions?: string,
  ) {
    this.type = type;
    this.modelName = modelName;
    this.userProvidedInstructions = userProvidedInstructions;
  }

  /**
   * Execute method for AI SDK streaming
   */
  abstract execute(options: unknown): Promise<unknown>;
}
