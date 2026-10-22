import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { directory, saveJson } from "./cli.js";
import { initialState, type State, type Store } from "./state.js";

// This local CLI keeps its manifest beside libfx's durable session files. Copy the whole STATE_DIR to move it.
export class FileStore implements Store {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private path = join(directory, "manifest.json")) {}
  async read(): Promise<State> {
    await this.queue;
    try {
      return JSON.parse(await readFile(this.path, "utf8")) as State;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return initialState();
      throw error;
    }
  }
  update(change: (draft: State) => void): Promise<void> {
    const next = this.queue.then(async () => {
      let state: State;
      try {
        state = JSON.parse(await readFile(this.path, "utf8"));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        state = initialState();
      }
      change(state);
      await saveJson(this.path, state);
    });
    this.queue = next.catch(() => {});
    return next;
  }
}
