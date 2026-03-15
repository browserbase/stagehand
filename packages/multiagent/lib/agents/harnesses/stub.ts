import type {
  AgentHarnessOptions,
  AgentHarnessRunResult,
  AgentRunInput,
} from "../../types.js";
import { UnsupportedAdapterError } from "../../utils/errors.js";
import { BaseHarness } from "./base.js";

export class StubHarness extends BaseHarness {
  constructor(
    readonly name:
      | "gemini-cli"
      | "opencode"
      | "browser-use",
    options: AgentHarnessOptions,
  ) {
    super(options);
  }

  async runTurn(_input: AgentRunInput): Promise<AgentHarnessRunResult> {
    throw new UnsupportedAdapterError("Agent harness", this.name);
  }
}
