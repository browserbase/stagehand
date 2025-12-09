/**
 * CUA Primitives API Server
 *
 * Exposes browser automation primitives as REST endpoints for external agents.
 *
 * Usage (standalone):
 *   ./start.sh                    # Start with defaults
 *   ./start.sh --port 8080        # Custom port
 *   ./start.sh --host 127.0.0.1   # Custom host
 *
 * Environment variables:
 *   CUA_SERVER_PORT - Server port (default: 3000)
 *   CUA_SERVER_HOST - Server host (default: 0.0.0.0)
 *
 * See README.md for full documentation.
 */

import { createServer } from "./server";
import { sessionManager } from "./sessionManager";

const PORT = parseInt(process.env.CUA_SERVER_PORT || "3000", 10);
const HOST = process.env.CUA_SERVER_HOST || "0.0.0.0";

async function main() {
  const server = createServer();

  // Graceful shutdown handling
  const shutdown = async (signal: string) => {
    console.log(`\nReceived ${signal}. Shutting down gracefully...`);

    try {
      // Close all browser sessions
      await sessionManager.destroyAllSessions();
      console.log("All browser sessions closed.");

      // Close the server
      await server.close();
      console.log("Server closed.");

      process.exit(0);
    } catch (error) {
      console.error("Error during shutdown:", error);
      process.exit(1);
    }
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  try {
    await server.listen({ port: PORT, host: HOST });
    console.log(`
╔════════════════════════════════════════════════════════════╗
║                 CUA Primitives API Server                  ║
╠════════════════════════════════════════════════════════════╣
║  Server running at http://${HOST}:${PORT}                     ║
║                                                            ║
║  Endpoints:                                                ║
║    GET  /health              - Health check                ║
║    GET  /sessions            - List active sessions        ║
║    POST /sessions            - Create browser session      ║
║    DELETE /sessions/:id      - Close browser session       ║
║    GET  /sessions/:id/state  - Get browser state           ║
║    POST /sessions/:id/action - Execute CUA primitive       ║
║                                                            ║
║  Press Ctrl+C to stop                                      ║
╚════════════════════════════════════════════════════════════╝
`);
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
}

main();

