import { randomUUID } from "crypto";

import cors from "@fastify/cors";
import fastify from "fastify";
import metricsPlugin from "fastify-metrics";
import { StatusCodes } from "http-status-codes";

import { logging } from "./lib/logging/index.js";
import { initializeSessionCache } from "./lib/session.js";
import healthcheckRoute from "./routes/healthcheck.js";
import readinessRoute, { setReady, setUnready } from "./routes/readiness.js";
import actRoute from "./routes/v1/sessions/:id/act.js";
import agentExecuteRoute from "./routes/v1/sessions/:id/agentExecute.js";
import endRoute from "./routes/v1/sessions/:id/end.js";
import extractRoute from "./routes/v1/sessions/:id/extract.js";
import navigateRoute from "./routes/v1/sessions/:id/navigate.js";
import observeRoute from "./routes/v1/sessions/:id/observe.js";
import replayRoute from "./routes/v1/sessions/:id/replay.js";
import startRoute from "./routes/v1/sessions/start.js";

// Constants for graceful shutdown
const READY_WAIT_PERIOD = 10_000; // 10 seconds
const GRACEFUL_SHUTDOWN_PERIOD = 30_000; // 30 seconds

const app = fastify({
  disableRequestLogging: true,

  genReqId: () => {
    return randomUUID();
  },

  logger: {
    formatters: {
      level(label: string) {
        return { level: label };
      },
    },

    level: process.env.NODE_ENV === "production" ? "info" : "trace",

    ...(process.env.NODE_ENV === "development" && {
      transport: {
        options: {
          colorize: true,
          ignore: "pid,hostname",
        },
        target: "pino-pretty",
      },
    }),
  },

  return503OnClosing: false,
});

export const logger = app.log;

process.on("uncaughtException", (error) => {
  app.log.error("Uncaught Exception:", error);
});

process.on("unhandledRejection", (reason, promise) => {
  app.log.error("Unhandled Rejection at:", promise, "reason:", reason);
});

// Graceful shutdown handler
const gracefulShutdown = async () => {
  app.log.info("gracefulShutdown");

  setUnready();

  await new Promise((resolve) => setTimeout(resolve, READY_WAIT_PERIOD));

  const timeout = setTimeout(() => {
    app.log.warn("forcefully shutting down after 30 seconds");
    process.exit(1);
  }, GRACEFUL_SHUTDOWN_PERIOD);

  timeout.unref();

  await app.close();
  clearTimeout(timeout);

  app.log.info("gracefulShutdown complete");
  process.exit(0);
};

// Handle termination signals
process.on("SIGTERM", () => {
  gracefulShutdown().catch((err: unknown) => {
    app.log.error(err, "error gracefully shutting down");
  });
});

process.on("SIGINT", () => {
  gracefulShutdown().catch((err: unknown) => {
    app.log.error(err, "error gracefully shutting down");
  });
});

const start = async () => {
  try {
    if (process.env.NODE_ENV === "development") {
      await app.register(cors, {
        origin: ["http://localhost:3000"],
        methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        allowedHeaders: ["*"],
        credentials: true,
      });
    }

    app.setErrorHandler((error, request, reply) => {
      request.log.error(`Server error: ${error.message}`);

      const statusCode = error.statusCode ?? StatusCodes.INTERNAL_SERVER_ERROR;

      /* eslint-disable-next-line  @typescript-eslint/no-floating-promises */
      reply.status(statusCode).send({
        error:
          statusCode === Number(StatusCodes.INTERNAL_SERVER_ERROR)
            ? "Internal Server Error"
            : error.message,
        statusCode,
      });
    });

    // disable the built-in validator
    app.setValidatorCompiler(() => () => true);

    await app.register(metricsPlugin.default, {
      defaultMetrics: {
        enabled: true,
        prefix: "stagehand_api_",
      },
      routeMetrics: {
        overrides: {
          histogram: {
            name: "stagehand_api_http_request_duration_seconds",
          },
          summary: {
            name: "stagehand_api_http_request_summary_seconds",
          },
        },
      },
    });

    await app.register(
      (app, _opts, done) => {
        app.route(actRoute);
        app.route(endRoute);
        app.route(extractRoute);
        app.route(navigateRoute);
        app.route(observeRoute);
        app.route(replayRoute);
        app.route(startRoute);
        app.route(agentExecuteRoute);
        done();
      },
      { prefix: "/v1" },
    );

    logging(app);

    // Initialize session cache with default configuration
    await initializeSessionCache(app.log);

    // Register health and readiness routes at the root level
    app.route(healthcheckRoute);
    app.route(readinessRoute);
    await app.ready();

    await app.listen({
      host: "0.0.0.0",
      port: parseInt(process.env.PORT ?? "80", 10),
    });
    /* eslint-disable no-console */
    console.log("Routes registered:", app.printRoutes());

    // Mark the server as ready after it's started
    setReady();
  } catch (err) {
    console.error("Failed to start server:", err);
    process.exit(1);
  }
};

start().catch((err: unknown) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
