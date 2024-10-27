import { Stagehand } from "../lib";

export class EvalLogger {
  logs: string[] = [];
  stagehand?: Stagehand;

  constructor() {}

  init(stagehand: Stagehand) {
    this.stagehand = stagehand;
  }

  log(message: string) {
    console.log(message);
    this.logs.push(message);
    // if (this.stagehand?.page && this.stagehand.context) {
    //   this.stagehand.page
    //     .evaluate((message: string) => {
    //       if (
    //         message.toLowerCase().includes("error:") ||
    //         message.toLowerCase().includes("trace:")
    //       ) {
    //         console.error(message);
    //       } else {
    //         console.log(message);
    //       }
    //     }, message)
    //     .catch(() => {});
    // }
  }

  error(message: string) {
    console.error(message);
    this.logs.push(`Error: ${message}`);
    // if (this.stagehand) {
    //   this.stagehand.page
    //     .evaluate((message: string) => console.error(message), message)
    //     .catch(() => {});
    // }
  }

  warn(message: string) {
    console.warn(message);
    this.logs.push(`Warning: ${message}`);
    // if (this.stagehand) {
    //   this.stagehand.page
    //     .evaluate((message: string) => console.warn(message), message)
    //     .catch(() => {});
    // }
  }

  getLogs() {
    return this.logs;
  }
}
