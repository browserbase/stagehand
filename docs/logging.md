# Stagehand Logging System

The Stagehand logging system uses [Pino](https://getpino.io/) to provide structured, efficient, and configurable logging.

## Log Levels

Stagehand uses three primary log levels:

| Level | Name  | Description                             |
| ----- | ----- | --------------------------------------- |
| 0     | error | Critical errors and important warnings  |
| 1     | info  | Standard information messages (default) |
| 2     | debug | Detailed information for debugging      |

The verbosity of logging is controlled by the `verbose` option when creating a Stagehand instance:

```typescript
const stagehand = new Stagehand({
  verbose: 2, // Show all logs up to debug level
  // other options...
});
```

## Using the Logger

The logging system is automatically initialized with your Stagehand instance. You can access it directly via:

```typescript
// Log an error
stagehand.log({
  message: "An error occurred",
  level: 0,
  category: "error",
});

// Log info (level 1 is default)
stagehand.log({
  message: "Operation completed",
  category: "operation",
});

// Log debug information
stagehand.log({
  message: "Debug details",
  level: 2,
  category: "debug",
  auxiliary: {
    details: {
      value: JSON.stringify({ key: "value" }),
      type: "object",
    },
  },
});
```

## Inference Logging

For detailed logging of inference operations (act, extract, observe), Stagehand provides specialized logging:

```typescript
// Enable inference logging to file
const stagehand = new Stagehand({
  logInferenceToFile: true,
  // other options...
});
```

When enabled, inference logs are written to the `inference_summary` directory in your project.

## Pretty Printing

By default, logs in development are formatted with colors and readable timestamps using Pino's pretty formatting. For production environments or when sending logs to external systems, you can disable pretty printing.

## Customizing Logging

### Using Your Own Logger

You can provide your own custom logger when creating a Stagehand instance:

```typescript
const stagehand = new Stagehand({
  logger: (logLine) => {
    // Your custom logging logic here
    console.log(`[${logLine.category}] ${logLine.message}`);
  },
  // other options...
});
```

When you provide a custom logger, Stagehand will automatically disable its internal Pino logger to prevent duplicate logging. Your logger will receive all log events directly.

### Configuring Pino

If you want to use Pino but with custom configuration:

```typescript
import { StagehandLogger } from "@browserbasehq/stagehand/lib/logger";

// Create a custom configured logger
const customLogger = new StagehandLogger({
  pretty: true,
  level: "debug",
  // Other Pino options...
});

// Pass it to Stagehand
const stagehand = new Stagehand({
  logger: (logLine) => customLogger.log(logLine),
  // other options...
});
```

## Advanced Usage

### Creating a New StagehandLogger Instance

You can create a standalone logger for use in your application:

```typescript
import { StagehandLogger } from "@browserbasehq/stagehand/lib/logger";

const logger = new StagehandLogger({
  pretty: true,
  level: "debug",
});

logger.info("Information message");
logger.debug("Debug message", { details: "some data" });
logger.error("Error message", { error: "details" });
```

### Configuring Log Output

You can direct logs to a file or other destination:

```typescript
import fs from "fs";
import { StagehandLogger } from "@browserbasehq/stagehand/lib/logger";

const fileStream = fs.createWriteStream("./logs/application.log", {
  flags: "a",
});

const logger = new StagehandLogger({
  destination: fileStream,
});
```

### Disabling Pino Explicitly

If you want to handle all logging yourself without using Pino:

```typescript
import { StagehandLogger } from "@browserbasehq/stagehand/lib/logger";

const logger = new StagehandLogger(
  {
    usePino: false,
  },
  (logLine) => {
    // Your custom logging logic
    console.log(`[${logLine.level}] ${logLine.message}`);
  },
);
```

## Troubleshooting

If you're not seeing logs:

1. Check your `verbose` setting - it may be too low for the log levels you're trying to see
2. Verify that your log messages have the correct level set
3. If using a custom logger, ensure it's correctly handling the log messages

If you're seeing duplicate logs:

1. Make sure you're not creating multiple instances of StagehandLogger that log to the same output
2. If providing a custom logger to Stagehand, it will automatically disable the internal Pino logger

If logs are not being written to files:

1. Ensure you have write permissions to the target directory
2. Check that the `logInferenceToFile` option is enabled
3. Verify that the destination path exists or can be created
