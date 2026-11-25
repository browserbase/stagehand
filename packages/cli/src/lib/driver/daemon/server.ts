import net from "node:net";
import readline from "node:readline";

import { classifyDriverError } from "../error-classifier.js";
import { DriverError } from "../errors.js";
import { DriverSessionManager } from "../session-manager.js";
import type { ConnectionTarget } from "../types.js";
import {
  cleanupDaemonFiles,
  ensureRuntimeDir,
  getPidPath,
  getSocketPath,
  writePrivateFile,
} from "./paths.js";
import { parseRequest, serializeResponse, type DriverRequest } from "./protocol.js";

interface RunDriverDaemonOptions {
  session: string;
  target: ConnectionTarget;
}

type ShutdownDaemon = (triggerSocket?: net.Socket) => Promise<void>;

export async function runDriverDaemon({ session, target }: RunDriverDaemonOptions): Promise<void> {
  await ensureRuntimeDir();
  await cleanupDaemonFiles(session, { includeLock: false });
  await writePrivateFile(getPidPath(session), String(process.pid));

  const socketPath = getSocketPath(session);
  const manager = new DriverSessionManager(session, target);
  const server = net.createServer();
  const activeSockets = new Set<net.Socket>();
  let shutdownPromise: Promise<void> | null = null;

  const shutdown: ShutdownDaemon = (triggerSocket): Promise<void> => {
    shutdownPromise ??= (async () => {
      const closing = closeServer(server);
      for (const socket of activeSockets) {
        if (socket !== triggerSocket) {
          socket.destroy();
        }
      }
      if (triggerSocket && !triggerSocket.destroyed) {
        const forceClose = setTimeout(() => {
          triggerSocket.destroy();
        }, 200);
        forceClose.unref();
        triggerSocket.once("close", () => clearTimeout(forceClose));
      }
      await closing;
      await manager.close();
      await cleanupDaemonFiles(session);
    })();
    return shutdownPromise;
  };

  server.on("connection", (socket) => {
    activeSockets.add(socket);
    socket.once("close", () => {
      activeSockets.delete(socket);
    });
    void handleConnection(socket, manager, shutdown);
  });

  process.once("SIGTERM", () => {
    void shutdown();
  });
  process.once("SIGINT", () => {
    void shutdown();
  });

  await new Promise<void>((resolve, reject) => {
    const handleListenError = (error: Error): void => {
      reject(error);
    };
    server.once("error", handleListenError);
    server.listen(socketPath, () => {
      server.off("error", handleListenError);
      resolve();
    });
  });

  server.on("error", () => {
    void shutdown();
  });

  await new Promise<void>((resolve) => {
    server.once("close", resolve);
  });

  await shutdown();
}

async function handleConnection(
  socket: net.Socket,
  manager: DriverSessionManager,
  shutdown: ShutdownDaemon,
): Promise<void> {
  const reader = readline.createInterface({ input: socket });
  const idleTimer = setTimeout(() => {
    reader.close();
    socket.destroy();
  }, 5_000);

  const cleanup = (): void => {
    clearTimeout(idleTimer);
    reader.close();
  };

  socket.once("error", () => {
    cleanup();
    socket.destroy();
  });
  socket.once("close", cleanup);

  reader.once("line", (line) => {
    clearTimeout(idleTimer);
    void handleLine(line, socket, manager)
      .then(async (shouldShutdown) => {
        await endSocket(socket);
        reader.close();
        socket.resume();
        if (shouldShutdown) await shutdown(socket);
      })
      .catch(() => {
        reader.close();
        socket.destroy();
      });
  });
}

async function handleLine(
  line: string,
  socket: net.Socket,
  manager: DriverSessionManager,
): Promise<boolean> {
  let request: DriverRequest;
  try {
    request = parseRequest(line);
  } catch (error) {
    await writeResponse(socket, { ...formatError(error), type: "error" });
    return false;
  }

  try {
    if (request.type === "open") {
      manager.applyForwardedEnv(request.forwardedEnv);
      await writeResponse(socket, {
        data: await manager.execute("open", {
          timeoutMs: request.timeoutMs,
          url: request.url,
          waitUntil: request.waitUntil,
        }),
        id: request.id,
        type: "success",
      });
      return false;
    }

    if (request.type === "command") {
      manager.applyForwardedEnv(request.forwardedEnv);
      await writeResponse(socket, {
        data: await manager.execute(request.command, request.params),
        id: request.id,
        type: "success",
      });
      return false;
    }

    if (request.type === "status") {
      await writeResponse(socket, {
        data: await manager.status(),
        id: request.id,
        type: "success",
      });
      return false;
    }

    await writeResponse(socket, {
      data: { stopped: true },
      id: request.id,
      type: "success",
    });
    return true;
  } catch (error) {
    await writeResponse(socket, {
      ...formatError(error),
      id: request.id,
      type: "error",
    });
    return false;
  }
}

function closeServer(server: net.Server): Promise<void> {
  if (!server.listening) return Promise.resolve();

  return new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function writeResponse(
  socket: net.Socket,
  response: Parameters<typeof serializeResponse>[0],
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    socket.write(serializeResponse(response), (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function endSocket(socket: net.Socket): Promise<void> {
  return new Promise((resolve) => {
    socket.end(resolve);
  });
}

function formatError(error: unknown): {
  code?: string;
  error: string;
  httpStatus?: number;
} {
  if (error instanceof DriverError) {
    return {
      code: error.code,
      error: error.message,
      ...(error.httpStatus !== undefined ? { httpStatus: error.httpStatus } : {}),
    };
  }

  const classified = classifyDriverError(error);
  if (classified) {
    return {
      code: classified.code,
      error: classified.message,
      ...(classified.httpStatus !== undefined ? { httpStatus: classified.httpStatus } : {}),
    };
  }

  try {
    return { error: error instanceof Error ? error.message : String(error) };
  } catch {
    return { error: "Unknown error" };
  }
}
