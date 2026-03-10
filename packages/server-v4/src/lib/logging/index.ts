import { FastifyInstance } from "fastify";

import { env } from "../../lib/env.js";

// List of routes to ignore for request logging in local environments
const ignoredRoutes = ["/healthz", "/readyz"];

// Helper function to determine if a request should be logged
const shouldLog = (url: string) => {
  return env.BB_ENV !== "local" || !ignoredRoutes.includes(url);
};

const logging = (app: FastifyInstance) => {
  // Add request logging hooks
  app.addHook("onRequest", (req, _reply, done) => {
    // Add request ID to response headers
    if (shouldLog(req.url)) {
      req.log.info(
        {
          req: {
            host: req.hostname,
            method: req.method,
            remoteAddress: req.ip,
            remotePort: req.socket.remotePort,
            url: req.url,
          },
          reqId: req.id,
        },
        "incoming request",
      );
    }
    done();
  });

  app.addHook("onResponse", (req, reply, done) => {
    if (shouldLog(req.url)) {
      req.log.info(
        {
          reqId: req.id,
          req: {
            host: req.hostname,
            method: req.method,
            remoteAddress: req.ip,
            remotePort: req.socket.remotePort,
            url: req.url,
          },
          res: {
            statusCode: reply.statusCode,
          },
          responseTime: reply.elapsedTime,
        },
        "request completed",
      );
    }
    done();
  });
};

export { logging };
