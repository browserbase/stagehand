import { StagehandFacadeSessionLostError } from "@browserbasehq/stagehand-integrations/facade";

export type BrowserSessionLossReader = () => { cause: string } | undefined;

export function isTerminalFacadeError(
  error: unknown,
  browserSessionLoss?: BrowserSessionLossReader,
): boolean {
  return error instanceof StagehandFacadeSessionLostError || browserSessionLoss?.() !== undefined;
}
