import { createHash } from "crypto";
import type { Logger, ScrapeOptions } from "../types/public";
import type { StagehandZodSchema } from "../zodCompat";
import { toJsonSchema } from "../zodCompat";
import { CacheStorage } from "./CacheStorage";
import { safeGetPageUrl } from "./utils";
import type { Page } from "../understudy/page";
import type { ScrapeResult } from "../types/public/methods";
import { SCRAPE_SCHEMA_FIELD } from "../types/public/methods";
import type {
  CachedScrapeEntry,
  ScrapeCacheContext,
  ScrapeCacheDeps,
  ScrapeRegexRule,
} from "../types/private";

export class ScrapeCache {
  private readonly storage: CacheStorage;
  private readonly logger: Logger;

  constructor({ storage, logger }: ScrapeCacheDeps) {
    this.storage = storage;
    this.logger = logger;
  }

  get enabled(): boolean {
    return this.storage.enabled;
  }

  async prepareContext({
    instruction,
    schema,
    page,
    options,
  }: {
    instruction?: string;
    schema?: StagehandZodSchema;
    page: Page;
    options?: ScrapeOptions;
  }): Promise<ScrapeCacheContext | null> {
    if (!this.enabled || !schema) {
      return null;
    }

    const sanitizedInstruction = instruction?.trim();
    const pageUrl = await safeGetPageUrl(page);
    const schemaJson = JSON.stringify(toJsonSchema(schema));
    const schemaHash = this.hash(schemaJson);
    const selector = options?.selector ?? "";
    const modelSignature = options?.model ? JSON.stringify(options.model) : "";

    const payload = JSON.stringify({
      instruction: sanitizedInstruction ?? "",
      pageUrl,
      schemaHash,
      selector,
      modelSignature,
    });
    const cacheKey = this.hash(payload);

    return {
      cacheKey,
      instruction: sanitizedInstruction,
      pageUrl,
      schemaHash,
      schemaJson,
      selector,
      modelSignature,
    };
  }

  async tryReplay(
    context: ScrapeCacheContext,
  ): Promise<CachedScrapeEntry | null> {
    if (!this.enabled) return null;

    const { value, error, path } =
      await this.storage.readJson<CachedScrapeEntry>(
        `${context.cacheKey}.json`,
      );

    if (error && path) {
      this.logger({
        category: "cache",
        message: `failed to read scrape cache entry: ${path}`,
        level: 2,
        auxiliary: { error: { value: String(error), type: "string" } },
      });
      return null;
    }

    if (!value || value.version !== 1) {
      return null;
    }

    if (value.schemaHash !== context.schemaHash) {
      return null;
    }

    this.logger({
      category: "cache",
      message: "scrape cache hit",
      level: 1,
      auxiliary: {
        instruction: context.instruction
          ? { value: context.instruction, type: "string" }
          : undefined,
        url: { value: context.pageUrl, type: "string" },
      },
    });

    return value;
  }

  async store(
    context: ScrapeCacheContext,
    payload: {
      references: ScrapeResult<StagehandZodSchema>;
      regexRules?: ScrapeRegexRule[];
      prompts?: { system?: string; user?: string };
    },
  ): Promise<void> {
    if (!this.enabled) return;

    const entry: CachedScrapeEntry = {
      version: 1,
      instruction: context.instruction,
      url: context.pageUrl,
      schemaHash: context.schemaHash,
      schemaJson: context.schemaJson,
      selector: context.selector,
      modelSignature: context.modelSignature,
      references: this.serializeReferences(payload.references),
      regexRules: payload.regexRules,
      prompts: payload.prompts,
      timestamp: new Date().toISOString(),
    };

    const { error, path } = await this.storage.writeJson(
      `${context.cacheKey}.json`,
      entry,
    );

    if (error && path) {
      this.logger({
        category: "cache",
        message: "failed to write scrape cache entry",
        level: 1,
        auxiliary: { error: { value: String(error), type: "string" } },
      });
      return;
    }

    this.logger({
      category: "cache",
      message: "scrape cache stored",
      level: 2,
      auxiliary: {
        instruction: context.instruction
          ? { value: context.instruction, type: "string" }
          : undefined,
        url: { value: context.pageUrl, type: "string" },
      },
    });
  }

  async updateRegexRules(
    cacheKey: string,
    rules: ScrapeRegexRule[],
  ): Promise<void> {
    if (!this.enabled || rules.length === 0) return;

    const { value, error, path } =
      await this.storage.readJson<CachedScrapeEntry>(`${cacheKey}.json`);

    if (error && path) {
      this.logger({
        category: "cache",
        message: `failed to update scrape cache entry: ${path}`,
        level: 2,
        auxiliary: { error: { value: String(error), type: "string" } },
      });
      return;
    }

    if (!value || value.version !== 1) return;

    value.regexRules = rules;
    await this.storage.writeJson(`${cacheKey}.json`, value);
  }

  private serializeReferences(references: unknown): unknown {
    return JSON.parse(
      JSON.stringify(references, (key, value) => {
        if (key === "resolve") {
          return undefined;
        }
        if (key === SCRAPE_SCHEMA_FIELD) {
          return undefined;
        }
        if (typeof key === "string" && key.startsWith("__stagehand")) {
          return undefined;
        }
        return value;
      }),
    );
  }

  private hash(value: string): string {
    return createHash("sha256").update(value).digest("hex");
  }
}
