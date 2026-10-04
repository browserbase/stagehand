import { StagehandFacadeSessionLostError } from "@browserbasehq/stagehand-integrations/facade";

export type BrowserSessionLossReader = () => { cause: string } | undefined;

/** Transport ownership, never page/model error text, decides terminal loss. */
export function isTerminalFacadeError(
  error: unknown,
  browserSessionLoss?: BrowserSessionLossReader,
): boolean {
  return error instanceof StagehandFacadeSessionLostError || browserSessionLoss?.() !== undefined;
}
