import { LogLine, Logger } from "../types/log";

/**
 * Creates a custom logger for Stagehand that formats logs to match
 * the debug log format used by DEBUG=pw:api,pw:browser*,sh:protocol
 * and labels entries with sh:api
 *
 * This logger writes to stderr to match the behavior of the debug module
 *
 * @returns {Logger} A logger function that can be passed to Stagehand's logger option
 */
export function createStagehandApiLogger(): Logger {
  return (logLine: LogLine): void => {
    // Generate timestamp in ISO format to match debug log format
    const timestamp = new Date().toISOString();

    // Use sh:api as the namespace
    const namespace = "sh:api";

    // Format the message with category if provided
    const categoryPrefix = logLine.category ? `[${logLine.category}] ` : "";
    const formattedMessage = `${categoryPrefix}${logLine.message}`;

    // Format auxiliary data if present
    let auxiliaryInfo = "";
    if (logLine.auxiliary) {
      const auxData: Record<string, string | number | boolean | object> = {};
      for (const [key, { value, type }] of Object.entries(logLine.auxiliary)) {
        // Convert values based on their type
        switch (type) {
          case "integer":
            auxData[key] = parseInt(value, 10);
            break;
          case "float":
            auxData[key] = parseFloat(value);
            break;
          case "boolean":
            auxData[key] = value === "true";
            break;
          case "object":
            try {
              auxData[key] = JSON.parse(value);
            } catch {
              auxData[key] = value;
            }
            break;
          default:
            auxData[key] = value;
        }
      }
      // Only add auxiliary info if there's actual data
      if (Object.keys(auxData).length > 0) {
        auxiliaryInfo = ` ${JSON.stringify(auxData)}`;
      }
    }

    // Construct the final log line in debug format: timestamp namespace message
    const logOutput = `${timestamp} ${namespace} ${formattedMessage}${auxiliaryInfo}\n`;

    // Write to stderr to match debug module behavior
    process.stderr.write(logOutput);
  };
}

/**
 * Example usage:
 *
 * ```typescript
 * import { Stagehand } from "@browserbasehq/stagehand";
 * import { createStagehandApiLogger } from "./stagehandApiLogger";
 *
 * const stagehand = new Stagehand({
 *   logger: createStagehandApiLogger(),
 *   // other options...
 * });
 * ```
 */
