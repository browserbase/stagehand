import type { ReadJsonResult, WriteJsonResult } from "../../types/private";
import type { StorageAdapter } from "./types";

/**
 * Service account credentials object.
 */
export interface GCSCredentials {
  client_email: string;
  private_key: string;
  project_id?: string;
}

/**
 * Options for creating a GCS adapter.
 */
export interface GCSAdapterOptions {
  /**
   * The GCS bucket name.
   */
  bucket: string;

  /**
   * Optional prefix for all cache keys (e.g., "stagehand-cache/").
   * A trailing slash will be added if not present.
   */
  prefix?: string;

  /**
   * Optional credentials for authentication. Can be:
   * - A GCSCredentials object with client_email and private_key
   * - A JSON string containing service account credentials
   * - A file path to a service account JSON file (for local development)
   *
   * If not provided, uses Application Default Credentials (ADC).
   */
  credentials?: GCSCredentials | string;

  /**
   * Optional project ID. If not provided, will be inferred from credentials.
   */
  projectId?: string;
}

/**
 * Google Cloud Storage adapter for serverless and cloud environments.
 *
 * This adapter requires `@google-cloud/storage` to be installed:
 * ```bash
 * npm install @google-cloud/storage
 * ```
 *
 * The package is loaded lazily, so it's only required if you actually use this adapter.
 *
 * @example Using with Trigger.dev or Cloud Functions
 * ```typescript
 * import { GCSAdapter } from "@browserbasehq/stagehand/cache/adapters";
 *
 * const adapter = new GCSAdapter({
 *   bucket: "my-stagehand-cache",
 *   prefix: "agent-cache/",
 * });
 *
 * const stagehand = new Stagehand({
 *   env: "BROWSERBASE",
 *   cacheAdapter: adapter,
 * });
 * ```
 *
 * @example Using with credentials from environment variable (serverless)
 * ```typescript
 * const adapter = new GCSAdapter({
 *   bucket: "my-stagehand-cache",
 *   credentials: process.env.GCS_CREDENTIALS, // JSON string
 * });
 * ```
 *
 * @example Using with credentials object
 * ```typescript
 * const adapter = new GCSAdapter({
 *   bucket: "my-stagehand-cache",
 *   credentials: {
 *     client_email: "...",
 *     private_key: "...",
 *   },
 * });
 * ```
 */
export class GCSAdapter implements StorageAdapter {
  readonly enabled: boolean = true;
  readonly description: string;

  private readonly bucketName: string;
  private readonly prefix: string;
  private readonly credentials?: GCSCredentials | string;
  private readonly projectId?: string;

  // Lazy-loaded GCS client
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private storageClient: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private bucket: any = null;

  constructor(options: GCSAdapterOptions) {
    this.bucketName = options.bucket;
    this.prefix = options.prefix
      ? options.prefix.endsWith("/")
        ? options.prefix
        : `${options.prefix}/`
      : "";
    this.credentials = options.credentials;
    this.projectId = options.projectId;
    this.description = `gcs: ${this.bucketName}/${this.prefix}`;
  }

  /**
   * Parse credentials from various formats.
   * - If object with client_email/private_key, use directly
   * - If string starting with '{', parse as JSON
   * - If other string, treat as file path
   */
  private parseCredentials(): {
    credentials?: GCSCredentials;
    keyFilename?: string;
  } {
    if (!this.credentials) {
      return {};
    }

    // Already an object
    if (typeof this.credentials === "object") {
      return { credentials: this.credentials };
    }

    // String - check if JSON or file path
    const trimmed = this.credentials.trim();
    if (trimmed.startsWith("{")) {
      // JSON string - parse it
      try {
        const parsed = JSON.parse(trimmed);
        return {
          credentials: {
            client_email: parsed.client_email,
            private_key: parsed.private_key,
            project_id: parsed.project_id,
          },
        };
      } catch {
        // If JSON parsing fails, treat as file path
        return { keyFilename: this.credentials };
      }
    }

    // File path
    return { keyFilename: this.credentials };
  }

  /**
   * Lazily initialize the GCS client.
   * This allows the adapter to be created without requiring the package
   * until the first actual operation.
   */
  private async getClient(): Promise<{
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    storage: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    bucket: any;
  }> {
    if (this.storageClient && this.bucket) {
      return { storage: this.storageClient, bucket: this.bucket };
    }

    // Dynamic import to avoid requiring the package unless used
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Storage } = await import("@google-cloud/storage");

    const { credentials, keyFilename } = this.parseCredentials();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const storageOptions: any = {
      projectId: this.projectId || credentials?.project_id,
    };

    if (credentials) {
      storageOptions.credentials = credentials;
    } else if (keyFilename) {
      storageOptions.keyFilename = keyFilename;
    }
    // Otherwise uses ADC

    this.storageClient = new Storage(storageOptions);
    this.bucket = this.storageClient.bucket(this.bucketName);

    return { storage: this.storageClient, bucket: this.bucket };
  }

  private buildObjectPath(key: string): string {
    return `${this.prefix}${key}`;
  }

  async readJson<T>(key: string): Promise<ReadJsonResult<T>> {
    const objectPath = this.buildObjectPath(key);

    try {
      const { bucket } = await this.getClient();
      const file = bucket.file(objectPath);
      const [contents] = await file.download();
      return { value: JSON.parse(contents.toString()) as T };
    } catch (err) {
      // GCS returns 404 for missing objects
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const statusCode = (err as any)?.code || (err as any)?.response?.status;
      if (statusCode === 404) {
        return { value: null };
      }
      return { value: null, error: err, path: `gs://${this.bucketName}/${objectPath}` };
    }
  }

  async writeJson(key: string, data: unknown): Promise<WriteJsonResult> {
    const objectPath = this.buildObjectPath(key);

    try {
      const { bucket } = await this.getClient();
      const file = bucket.file(objectPath);
      await file.save(JSON.stringify(data, null, 2), {
        contentType: "application/json",
        resumable: false, // Disable resumable uploads for small files
      });
      return {};
    } catch (err) {
      return { error: err, path: `gs://${this.bucketName}/${objectPath}` };
    }
  }
}
