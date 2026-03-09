import os from "node:os";
import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";

import type { ActionStore, ActionStoreListOptions } from "./ActionStore.js";
import type { PageAction } from "../schemas/v4/page.js";

const DEFAULT_ACTION_STORE_PATH = path.join(
  os.tmpdir(),
  "stagehand-server-v4-actions.jsonl",
);

export class JsonlActionStore implements ActionStore {
  private loaded = false;
  private readonly actions = new Map<string, PageAction>();

  constructor(
    private readonly filePath: string = process.env.STAGEHAND_ACTION_STORE_PATH ??
      DEFAULT_ACTION_STORE_PATH,
  ) {}

  async putAction(action: PageAction): Promise<void> {
    await this.ensureLoaded();
    this.actions.set(action.id, action);
    await this.persist();
  }

  async getAction(actionId: string): Promise<PageAction | null> {
    await this.ensureLoaded();
    return this.actions.get(actionId) ?? null;
  }

  async listActions(options: ActionStoreListOptions): Promise<PageAction[]> {
    await this.ensureLoaded();

    const actions = [...this.actions.values()]
      .filter((action) => action.sessionId === options.sessionId)
      .filter((action) =>
        options.pageId ? action.pageId === options.pageId : true,
      )
      .filter((action) =>
        options.method ? action.method === options.method : true,
      )
      .filter((action) =>
        options.status ? action.status === options.status : true,
      )
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));

    if (!options.limit) {
      return actions;
    }

    return actions.slice(0, options.limit);
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) {
      return;
    }

    try {
      const raw = await readFile(this.filePath, "utf8");
      for (const line of raw.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) {
          continue;
        }
        const action = JSON.parse(trimmed) as PageAction;
        this.actions.set(action.id, action);
      }
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code !== "ENOENT") {
        throw error;
      }
    }

    this.loaded = true;
  }

  private async persist(): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });

    const serialized = [...this.actions.values()]
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .map((action) => JSON.stringify(action))
      .join("\n");

    await writeFile(
      this.filePath,
      serialized.length > 0 ? `${serialized}\n` : "",
      "utf8",
    );
  }
}
