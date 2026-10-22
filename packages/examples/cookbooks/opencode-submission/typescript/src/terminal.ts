import { createInterface, type Interface } from "node:readline";
import type { Readable, Writable } from "node:stream";

export class Terminal {
  readonly enabled: boolean;
  private reader?: Interface;
  private lines?: AsyncIterator<string>;
  private readonly input: Readable;
  private readonly output: Writable;

  constructor(options: { enabled?: boolean; input?: Readable; output?: Writable } = {}) {
    this.enabled = options.enabled ?? Boolean(process.stdin.isTTY && process.stdout.isTTY);
    this.input = options.input ?? process.stdin;
    this.output = options.output ?? process.stdout;
  }

  async choose<Choice extends string>(
    prompt: string,
    choices: readonly Choice[],
  ): Promise<Choice | "pause"> {
    if (!this.enabled) return "pause";
    if (!this.reader) {
      this.reader = createInterface({
        input: this.input,
        output: this.output,
        terminal: Boolean(process.stdin.isTTY && this.input === process.stdin),
      });
      this.reader.on("SIGINT", () => this.close());
      this.lines = this.reader[Symbol.asyncIterator]();
    }
    while (true) {
      this.output.write(prompt);
      const line = await this.lines!.next();
      if (line.done) return "pause";
      const value = line.value.trim().toLowerCase();
      if (value === "pause") return "pause";
      if (choices.includes(value as Choice)) return value as Choice;
      this.output.write(`Enter ${[...choices, "pause"].join(", ")}.\n`);
    }
  }

  close() {
    this.reader?.close();
  }
}
