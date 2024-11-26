import { Stagehand } from "../lib";
import { logLineToString } from "../lib/utils";
import { LogLine } from "../types/log";

type LogLineEval = LogLine & {
  parsedAuxiliary?: string | object;
};

function parseLogLine(logLine: LogLine): LogLineEval {
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
