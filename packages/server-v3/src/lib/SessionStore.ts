import type {
  Api,
  LocalBrowserLaunchOptions,
  LogLine,
  V3,
} from "@browserbasehq/stagehand";

/**
 * Result from SessionStore.startSession().
 */
export type SessionStartResult = Api.SessionStartResult;

/**
 * Parameters for creating a new session.
 * This is what gets persisted - a subset of StartSessionParams
 * that excludes runtime-only values like modelApiKey.
 *
 * Includes cloud-specific fields that pass through to cloud implementations.
 * The library ignores fields it doesn't need, but they're available to SessionStore.
 */
export interface CreateSessionParams {
  /** Browser choice for this session */
  browserType: "local" | "browserbase";
  /** Model name (e.g., "openai/gpt-4o") */
  modelName: string;
  /** Verbosity level */
  verbose?: 0 | 1 | 2;
  /** Custom system prompt */
  systemPrompt?: string;
  /** Enable self-healing for failed actions */
  selfHeal?: boolean;
  /** DOM settle timeout in milliseconds */
  domSettleTimeoutMs?: number;
  /** Enable experimental features */
  experimental?: boolean;

  // Browserbase-specific (used by cloud implementations)
  /** Browserbase API key */
  browserbaseApiKey?: string;
  /** Browserbase project ID */
  browserbaseProjectId?: string;
  /** Existing Browserbase session ID to connect to */
  browserbaseSessionID?: string;
  /** Wait for captcha solves */
  waitForCaptchaSolves?: boolean;
  /** Browserbase session creation params */
  browserbaseSessionCreateParams?: Record<string, unknown>;
  /** Local browser launch overrides when browserType is local */
  localBrowserLaunchOptions?: LocalBrowserLaunchOptions;

  /** WebSocket URL for connecting to the browser (returned to client) */
  connectUrl?: string;

  // Cloud-specific metadata fields
  /** Act timeout in milliseconds */
  actTimeoutMs?: number;
  /** Client language (typescript, python, playground) */
  clientLanguage?: string;
  /** SDK version */
  sdkVersion?: string;
}

/**
 * Request-time context passed when resolving a session.
 * Contains values that come from request headers rather than storage.
 */
export interface RequestContext {
  /** Model API key (from x-model-api-key header) */
  modelApiKey?: string;
  /** Logger function for this request */
  logger?: (message: LogLine) => void;
}

/**
 * Configuration options for session cache behavior.
 */
export interface SessionCacheConfig {
  /** Maximum number of sessions to cache. Default: 100 */
  maxCapacity?: number;
  /** TTL for cached sessions in milliseconds. Default: 300000 (5 minutes) */
  ttlMs?: number;
}

/**
 * SessionStore interface for managing session lifecycle and V3 instances.
 *
 * The library provides an InMemorySessionStore as the default implementation
 * with full caching support (TTL, LRU eviction, etc.).
 *
 * Cloud environments can implement this interface to:
 * - Persist session config to a database
 * - Use custom caching strategies (e.g., LaunchDarkly-driven config)
 * - Add eviction hooks for cleanup
 * - Handle platform-specific session lifecycle (e.g., Browserbase)
 *
 * This enables stateless pod architectures where any pod can handle any request.
 */
export interface SessionStore {
  /**
   * Start a new session.
   *
   * This is the main entry point for session creation. Implementations can:
   * - Create platform-specific resources (e.g., Browserbase session)
   * - Persist session config to storage
   * - Check feature flags for availability
   *
   * @param params - Session configuration
   * @returns Session ID and availability status
   */
  startSession(params: CreateSessionParams): Promise<SessionStartResult>;

  /**
   * End a session and cleanup all resources.
   *
   * This is the main entry point for session cleanup. Implementations can:
   * - Close platform-specific resources (e.g., Browserbase session)
   * - Evict V3 instance from cache
   * - Update session status in storage
   *
   * @param sessionId - The session identifier
   */
  endSession(sessionId: string): Promise<void>;

  /**
   * Check if a session exists.
   * @param sessionId - The session identifier
   * @returns true if the session exists
   */
  hasSession(sessionId: string): Promise<boolean>;

  /**
   * Get or create a V3 instance for a session.
   *
   * This method handles:
   * - Checking the cache for an existing V3 instance
   * - On cache miss: loading config, creating V3, caching it
   * - Updating the logger reference for streaming
   *
   * @param sessionId - The session identifier
   * @param ctx - Request-time context containing values from headers
   * @returns The V3 instance ready for use
   * @throws Error if session not found
   */
  getOrCreateStagehand(sessionId: string, ctx: RequestContext): Promise<V3>;

  /**
   * Create a new session with the given parameters.
   * Lower-level than startSession - just stores the config.
   * @param sessionId - The session identifier
   * @param params - Session configuration to persist
   */
  createSession(sessionId: string, params: CreateSessionParams): Promise<void>;

  /**
   * Delete a session from cache and close V3 instance.
   * Lower-level than endSession - just handles cache cleanup.
   * @param sessionId - The session identifier
   */
  deleteSession(sessionId: string): Promise<void>;

  /**
   * Retrieve the stored session configuration for a given session.
   * @param sessionId - The session identifier
   */
  getSessionConfig(sessionId: string): Promise<CreateSessionParams>;

  /**
   * Update cache configuration dynamically.
   * @param config - New cache configuration values
   */
  updateCacheConfig?(config: SessionCacheConfig): void;

  /**
   * Get current cache configuration.
   * @returns Current cache config
   */
  getCacheConfig?(): SessionCacheConfig;

  /**
   * Cleanup all resources (close all V3 instances, stop timers).
   * Called when shutting down the server.
   */
  destroy(): Promise<void>;
}
