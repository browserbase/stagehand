import fs from "fs";
import path from "path";
import type { Logger } from "../types/public/index.js";
import {
  CacheCategory,
  ReadJsonResult,
  WriteJsonResult,
} from "../types/private/index.js";

const jsonClone = <T>(value: T): T => {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    return value;
  }
  return JSON.parse(serialized) as T;
};

/**
 * Configuration for the Valkey cache backend.
 */
export interface ValkeyCacheOptions {
  /** Valkey host address. */
  host: string;
  /** Valkey port (default: 6379). */
  port?: number;
  /** Enable TLS for the connection. */
  useTls?: boolean;
  /** Authentication password (IAM token or static auth token). */
  password?: string;
  /** Authentication username (for ACL-enabled instances). */
  username?: string;
  /** Default TTL in seconds for cache entries. Omit for no expiry. */
  cacheTtl?: number;
  /** Key prefix namespace (default: "stagehand"). */
  keyPrefix?: string;
  /** Request timeout in ms (default: 5000). */
  requestTimeout?: number;
  /** Max allowed cache value size in bytes (default: 5MB). Writes exceeding this are skipped. */
  maxCacheValueBytes?: number;
}

/**
 * Options shape for ValkeyClientLike.set(), matching GLIDE's expiry API.
 */
interface ValkeySetOptions {
  expiry?: { type: "EX" | "PX" | "EXAT" | "PXAT"; count: number };
}

/**
 * Minimal interface matching the subset of Valkey client methods used by
 * CacheStorage. This avoids a hard compile-time dependency on iovalkey
 * for users who don't need the Valkey backend.
 */
interface ValkeyClientLike {
  get(key: string): Promise<string | null>;
  set(
    key: string,
    value: string,
    options?: ValkeySetOptions,
  ): Promise<string | null>;
  del(keys: string[]): Promise<number>;
  close(): Promise<void>;
}

/**
 * Minimal type shape for the dynamically imported iovalkey module.
 */
interface IovalkeyModule {
  default: new (options: Record<string, unknown>) => IovalkeyClient;
}

interface IovalkeyClient {
  connect(): Promise<void>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ...args: unknown[]): Promise<string | null>;
  del(...keys: string[]): Promise<number>;
  quit(): Promise<string>;
  disconnect(): void;
}

export class CacheStorage {
  private constructor(
    private readonly logger: Logger,
    private readonly dir?: string,
    private readonly memoryStore?: Map<string, unknown>,
    private readonly valkeyClient?: ValkeyClientLike,
    private readonly valkeyOptions?: ValkeyCacheOptions,
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

  static createMemory(logger: Logger): CacheStorage {
    return new CacheStorage(logger, undefined, new Map());
  }

  /**
   * Create a CacheStorage backed by Valkey via iovalkey.
   * Requires `iovalkey` to be installed as an optional dependency.
   * Returns a disabled CacheStorage if the connection fails.
   */
  static async createValkey(
    options: ValkeyCacheOptions,
    logger: Logger,
  ): Promise<CacheStorage> {
    try {
      const mod = (await import(
        /* webpackIgnore: true */ /* @vite-ignore */ "iovalkey"
      )) as unknown as IovalkeyModule;
      const Valkey = mod.default;

      if (options.username && !options.password) {
        throw new Error(
          "Valkey cache: username was provided without a password. " +
            "Supply both username and password, or omit both.",
        );
      }

      // Default TLS on when credentials are present to avoid plaintext transit.
      const useTLS = options.useTls ?? !!options.password;
      const port = options.port ?? 6379;

      const iovalkeyOpts: Record<string, unknown> = {
        host: options.host,
        port,
        ...(options.password ? { password: options.password } : {}),
        ...(options.username ? { username: options.username } : {}),
        ...(useTLS ? { tls: {} } : {}),
        commandTimeout: options.requestTimeout ?? 5000,
        maxRetriesPerRequest: 3,
        retryStrategy: (times: number): number | null =>
          times > 5 ? null : Math.min(times * 500, 5000),
        connectionName: "stagehand-cache",
        lazyConnect: true,
      };

      const rawClient = new Valkey(iovalkeyOpts);
      await rawClient.connect();

      // Adapt iovalkey's API to ValkeyClientLike
      const client: ValkeyClientLike = {
        get: (key) => rawClient.get(key),
        set: (key, value, setOpts?) => {
          if (setOpts?.expiry) {
            return rawClient.set(
              key,
              value,
              setOpts.expiry.type,
              setOpts.expiry.count,
            );
          }
          return rawClient.set(key, value);
        },
        del: (keys) =>
          keys.length > 0 ? rawClient.del(...keys) : Promise.resolve(0),
        close: (): Promise<void> => rawClient.quit().then((): void => {}),
      };

      logger({
        category: "cache",
        message: `valkey cache connected to ${options.host}:${port}`,
        level: 1,
      });

      return new CacheStorage(logger, undefined, undefined, client, options);
    } catch (err) {
      const safeMessage = err instanceof Error ? err.message : "unknown error";
      logger({
        category: "cache",
        message: `unable to initialize valkey cache: ${safeMessage}`,
        level: 1,
        auxiliary: {
          error: { value: safeMessage, type: "string" },
        },
      });
      return new CacheStorage(logger);
    }
  }

  get directory(): string | undefined {
    return this.dir;
  }

  get enabled(): boolean {
    return !!this.dir || !!this.memoryStore || !!this.valkeyClient;
  }

  /**
   * Close the underlying Valkey client connection, if any.
   * Safe to call multiple times or when no Valkey client is attached.
   */
  async close(): Promise<void> {
    if (this.valkeyClient) {
      try {
        await this.valkeyClient.close();
      } catch (err) {
        this.logger({
          category: "cache",
          message: `valkey close error (best-effort): ${err instanceof Error ? err.message : "unknown"}`,
          level: 2,
        });
      }
    }
  }

  private resolvePath(fileName: string): string | null {
    if (!this.dir) return null;
    return path.join(this.dir, fileName);
  }

  /**
   * Derive the Valkey key from a cache fileName and explicit category.
   * Strips any redundant category prefix from the fileName (e.g. "agent-")
   * since the category is already encoded in the key namespace.
   */
  private toValkeyKey(fileName: string, category: CacheCategory): string {
    const prefix = this.valkeyOptions?.keyPrefix ?? "stagehand";
    const base = fileName.replace(/\.json$/, "").replace(/^agent-/, "");
    return `${prefix}:${category}:${base}`;
  }

  async readJson<T>(
    fileName: string,
    category: CacheCategory = "act",
  ): Promise<ReadJsonResult<T>> {
    if (this.valkeyClient) {
      const key = this.toValkeyKey(fileName, category);
      try {
        const raw = await this.valkeyClient.get(key);
        if (raw === null) {
          return { value: null };
        }
        try {
          return { value: JSON.parse(raw) as T };
        } catch (parseErr) {
          // Corrupt data — delete the poisoned key so subsequent reads don't
          // keep failing until TTL expiry.
          this.logger({
            category: "cache",
            message: `valkey key ${key} contains corrupt JSON; deleting`,
            level: 1,
            auxiliary: {
              error: { value: String(parseErr), type: "string" },
            },
          });
          try {
            await this.valkeyClient.del([key]);
          } catch (delErr) {
            this.logger({
              category: "cache",
              message: `valkey del error for corrupt key ${key} (best-effort): ${delErr instanceof Error ? delErr.message : "unknown"}`,
              level: 2,
            });
          }
          return { value: null, error: parseErr, path: key };
        }
      } catch (err) {
        this.logger({
          category: "cache",
          message: `valkey read error for key ${key}`,
          level: 1,
          auxiliary: {
            error: { value: String(err), type: "string" },
          },
        });
        return { value: null, error: err, path: key };
      }
    }

    if (this.memoryStore) {
      if (!this.memoryStore.has(fileName)) {
        return { value: null };
      }
      const existing = this.memoryStore.get(fileName) as T;
      return { value: jsonClone(existing) };
    }

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

  async writeJson(
    fileName: string,
    data: unknown,
    category: CacheCategory = "act",
  ): Promise<WriteJsonResult> {
    if (this.valkeyClient) {
      const key = this.toValkeyKey(fileName, category);
      try {
        const serialized = JSON.stringify(data);
        const maxBytes = this.valkeyOptions?.maxCacheValueBytes ?? 5_242_880;
        if (Buffer.byteLength(serialized, "utf8") > maxBytes) {
          this.logger({
            category: "cache",
            message: `valkey write skipped: payload exceeds ${maxBytes} byte limit`,
            level: 1,
          });
          return {
            error: new Error("cache value exceeds size limit"),
            path: key,
          };
        }
        const ttl = this.valkeyOptions?.cacheTtl;
        if (ttl !== undefined && ttl > 0) {
          await this.valkeyClient.set(key, serialized, {
            expiry: { type: "EX", count: ttl },
          });
        } else {
          await this.valkeyClient.set(key, serialized);
        }
        return {};
      } catch (err) {
        this.logger({
          category: "cache",
          message: `valkey write error for key ${key}`,
          level: 1,
          auxiliary: {
            error: { value: String(err), type: "string" },
          },
        });
        return { error: err, path: key };
      }
    }

    if (this.memoryStore) {
      this.memoryStore.set(fileName, jsonClone(data));
      return {};
    }

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
