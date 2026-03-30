/**
 * Shared constants for server-v4 runtime configuration and path conventions.
 * @constant
 */
export const constants = {
  llm: {
    /**
     * The display name used when the server materializes a system default LLM.
     * @constant
     */
    defaultDisplayName: "Default LLM",

    /**
     * The default model name used for system-generated LLM configs.
     * @constant
     */
    defaultModelName: "openai/gpt-4.1-nano",
  },
  paths: {
    /**
     * The default local config directory name under the user's home directory.
     * @constant
     */
    defaultConfigDirName: ".stagehand",

    /**
     * The relative path segments used for the local persistent PGlite database.
     * @constant
     */
    pgliteDataDirSegments: ["db", "stagehand-v4"] as const,
  },
  urls: {
    /**
     * TODO: Replace this placeholder once the real v4 database URL has been provisioned.
     * @constant
     */
    defaultDatabaseUrl: "postgresql://example.com/stagehand_v4",
  },
} as const;
