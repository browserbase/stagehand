import {
  AgentAction,
  AgentResult,
  AgentType,
  AgentExecutionOptions,
} from "../types/public/agent.js";
import { ClientOptions } from "../types/public/model.js";

/**
 * Abstract base class for agent clients
 * This provides a common interface for all agent implementations
 */
export abstract class AgentClient {
  public type: AgentType;
  public modelName: string;
  public clientOptions: ClientOptions;
  public userProvidedInstructions?: string;

  constructor(
    type: AgentType,
    modelName: string,
    userProvidedInstructions?: string,
  ) {
    this.type = type;
    this.modelName = modelName;
    this.userProvidedInstructions = userProvidedInstructions;
    this.clientOptions = {};
  }

  abstract execute(options: AgentExecutionOptions): Promise<AgentResult>;

  abstract captureScreenshot(
    options?: Record<string, unknown>,
  ): Promise<unknown>;

  abstract setViewport(width: number, height: number): void;

  abstract setCurrentUrl(url: string): void;

  abstract setScreenshotProvider(provider: () => Promise<string>): void;

  abstract setActionHandler(
    handler: (action: AgentAction) => Promise<void>,
  ): void;
}
