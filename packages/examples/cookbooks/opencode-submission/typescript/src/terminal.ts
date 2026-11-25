import { createInterface, type Interface } from "node:readline";

export class Terminal {
  readonly enabled: boolean;
  private reader?: Interface;
  private lines?: AsyncIterator<string>;
  constructor(interactive = true) {
    this.enabled = interactive && Boolean(process.stdin.isTTY && process.stdout.isTTY);
  }

  async choose<Choice extends string>(
    prompt: string,
    choices: readonly Choice[],
  ): Promise<Choice | "pause"> {
    if (!this.enabled) return "pause";
    if (!this.reader) {
      this.reader = createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: true,
      });
      this.reader.on("SIGINT", () => this.close());
      this.lines = this.reader[Symbol.asyncIterator]();
    }
    while (true) {
      process.stdout.write(prompt);
      const line = await this.lines!.next();
      if (line.done) return "pause";
      const value = line.value.trim().toLowerCase();
      if (value === "pause") return "pause";
      if (choices.includes(value as Choice)) return value as Choice;
      process.stdout.write(`Enter ${[...choices, "pause"].join(", ")}.\n`);
    }
  }

  close() {
    this.reader?.close();
  }
}
