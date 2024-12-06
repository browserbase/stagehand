import { AvailableModel, Stagehand } from "../lib";
import { logLineToString } from "../lib/utils";
import { LogLine } from "../types/log";

export const env: "BROWSERBASE" | "LOCAL" =
  process.env.EVAL_ENV?.toLowerCase() === "browserbase"
    ? "BROWSERBASE"
    : "LOCAL";

const enableCaching = process.env.EVAL_ENABLE_CACHING?.toLowerCase() === "true";

const defaultStagehandOptions = {
  env,
  headless: false,
  verbose: 2 as const,
  debugDom: true,
  enableCaching,
};

export const initStagehand = async ({
  modelName,
  domSettleTimeoutMs,
  logger,
}: {
  modelName: AvailableModel;
  domSettleTimeoutMs?: number;
  logger: EvalLogger;
}) => {
  const stagehand = new Stagehand({
    ...defaultStagehandOptions,
    logger: (logLine: LogLine) => {
      logger.log(logLine);
    },
  });
  logger.init(stagehand);
  const initResponse = await stagehand.init({ modelName, domSettleTimeoutMs });
  return { stagehand, logger, initResponse };
};

type LogLineEval = LogLine & {
  parsedAuxiliary?: string | object;
};

function parseLogLine(logLine: LogLine): LogLineEval {
  try {
    return {
      ...logLine,
      auxiliary: undefined,
      parsedAuxiliary: logLine.auxiliary
        ? Object.fromEntries(
            Object.entries(logLine.auxiliary).map(([key, entry]) => [
              key,
              entry.type === "object" ? JSON.parse(entry.value) : entry.value,
            ]),
          )
        : undefined,
    } as LogLineEval;
  } catch (e) {
    console.log("Error parsing log line", logLine);
    console.error(e);
    return logLine;
  }
}

export class EvalLogger {
  logs: LogLineEval[] = [];
  stagehand?: Stagehand;

  constructor() {}

  init(stagehand: Stagehand) {
    this.stagehand = stagehand;
  }

  log(logLine: LogLine) {
    console.log(logLineToString(logLine));
    this.logs.push(parseLogLine(logLine));
  }

  error(logLine: LogLine) {
    console.error(logLineToString(logLine));
    this.logs.push(parseLogLine(logLine));
  }

  warn(logLine: LogLine) {
    console.warn(logLineToString(logLine));
    this.logs.push(parseLogLine(logLine));
  }

  getLogs() {
    return this.logs;
  }
}

export function normalizeString(str: string): string {
  return str
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, "")
    .trim();
}
