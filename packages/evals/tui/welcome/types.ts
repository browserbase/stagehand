export type WizardOutcome =
  | { status: "completed"; runNext: string | null }
  | { status: "cancelled" };

import type { TaskRegistry } from "../../framework/types.js";

export type WelcomeRunContext = {
  entryDir: string;
  getRegistry: () => Promise<TaskRegistry>;
};
