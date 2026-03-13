import type { Page } from "../../understudy/page.js";
import type {
  AgentModelConfig,
  AgentToolMode,
  Variables,
} from "../../types/public/agent.js";

/**
 * Options passed from createAgentTools() to each tool factory.
 */
export interface AgentToolFactoryOptions {
  executionModel?: string | AgentModelConfig;
  provider?: string;
  variables?: Variables;
  mode?: AgentToolMode;
  toolTimeout?: number;
  page?: Page;
}
