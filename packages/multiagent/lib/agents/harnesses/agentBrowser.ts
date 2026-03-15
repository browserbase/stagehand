import type {
  AgentHarnessOptions,
  AgentHarnessRunResult,
  AgentRunInput,
} from "../../types.js";
import { MultiagentError } from "../../utils/errors.js";
import { BaseHarness } from "./base.js";

export function getAgentBrowserHarnessMessage(): string {
  return 'The upstream "agent-browser" project is a browser automation CLI/runtime, not an LLM agent harness. Use the "agent-browser" MCP/tool adapter, or pair another harness with browser tools instead.';
}

export class AgentBrowserHarness extends BaseHarness {
  readonly name = "agent-browser" as const;

  constructor(options: AgentHarnessOptions) {
    super(options);
  }

  async runTurn(_input: AgentRunInput): Promise<AgentHarnessRunResult> {
    throw new MultiagentError(getAgentBrowserHarnessMessage());
  }
}
