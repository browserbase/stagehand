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

  /** Optional hook called at the top of every step in the agent loop. */
  protected preStepHook?: () => Promise<void>;

  setPreStepHook(handler: () => Promise<void>): void {
    this.preStepHook = handler;
  }

  /**
   * Optional ephemeral context note that should be sent to the next model turn.
   * Clients that do not support this can ignore it.
   */
  addContextNote(note: string): void {
    void note;
    // no-op by default
  }
}
