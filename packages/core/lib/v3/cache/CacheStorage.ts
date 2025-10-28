import fs from "fs";
import path from "path";
import type { Logger } from "../types/public";
import { ReadJsonResult, WriteJsonResult } from "../types/private";

export class CacheStorage {
  private constructor(
    private readonly logger: Logger,
    private readonly dir?: string,
  ) {}

  static create(
    cacheDir: string | undefined,
    logger: Logger,
    options?: { label?: string },
  ): CacheStorage {
    if (!cacheDir) {
      return new CacheStorage(logger);
    }

    const resolved = path.resolve(cacheDir);
    try {
      fs.mkdirSync(resolved, { recursive: true });
      return new CacheStorage(logger, resolved);
    } catch (err) {
      const label = options?.label ?? "cache directory";
      logger({
        category: "cache",
        message: `unable to initialize ${label}: ${resolved}`,
        level: 1,
        auxiliary: {
          error: { value: String(err), type: "string" },
        },
      });
      return new CacheStorage(logger);
    }
  }

  get directory(): string | undefined {
    return this.dir;
  }

  get enabled(): boolean {
    return !!this.dir;
  }

  private resolvePath(fileName: string): string | null {
    if (!this.dir) return null;
    return path.join(this.dir, fileName);
  }

  async readJson<T>(fileName: string): Promise<ReadJsonResult<T>> {
    const filePath = this.resolvePath(fileName);
    if (!filePath) {
      return { value: null };
    }

    try {
      const raw = await fs.promises.readFile(filePath, "utf8");
      return { value: JSON.parse(raw) as T };
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code === "ENOENT") {
        return { value: null };
      }
      return { value: null, error: err, path: filePath };
    }
  }

  async writeJson(fileName: string, data: unknown): Promise<WriteJsonResult> {
    const filePath = this.resolvePath(fileName);
    if (!filePath) {
      return {};
    }

    try {
      await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
      await fs.promises.writeFile(
        filePath,
        JSON.stringify(data, null, 2),
        "utf8",
      );
      return {};
    } catch (err) {
      return { error: err, path: filePath };
    }
  }
}
