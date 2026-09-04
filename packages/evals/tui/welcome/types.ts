/** Shared contract every welcome variant returns to its caller. */
export type WizardOutcome =
  | { status: "completed"; runNext: string | null }
  | { status: "cancelled" };

import type { TaskRegistry } from "../../framework/types.js";

/** What a variant gets from the CLI / REPL that launched it. */
export type WelcomeRunContext = {
  entryDir: string;
  getRegistry: () => Promise<TaskRegistry>;
};
