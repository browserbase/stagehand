import { LogLine } from "../lib/types";
import { Stagehand } from "../lib";
import { logLineToString } from "../lib/utils";

export class EvalLogger {
  logs: LogLine[] = [];
  stagehand?: Stagehand;

  constructor() {}

  init(stagehand: Stagehand) {
    this.stagehand = stagehand;
  }

  log(logLine: LogLine) {
    console.log(logLineToString(logLine));
    this.logs.push(logLine);
  }

  error(logLine: LogLine) {
    console.error(logLineToString(logLine));
    this.logs.push(logLine);
  }

  warn(logLine: LogLine) {
    console.warn(logLineToString(logLine));
    this.logs.push(logLine);
  }

  getLogs() {
    return this.logs;
  }
}
