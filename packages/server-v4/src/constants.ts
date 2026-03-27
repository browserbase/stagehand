/**
 * Shared constants for server-v4 runtime configuration and path conventions.
 * @constant
 */
export const constants = {
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
     * TODO(sam): Replace this placeholder once the real v4 database URL has been provisioned.
     * @constant
     */
    defaultDatabaseUrl: "postgresql://example.com/stagehand_v4",
  },
} as const;
