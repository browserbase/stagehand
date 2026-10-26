import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { LLMGenerateResult } from "@browserbasehq/stagehand-protocol/types";
import {
  localBrowser,
  Stagehand,
  type ClientLLM,
  type LocalBrowserLaunchOptions,
} from "../../src/index.js";

export type FixtureResponse = {
  status?: number;
  headers?: Record<string, string>;
  body?: string;
};

export type FixtureHandler = (
  request: IncomingMessage,
) => FixtureResponse | string | Promise<FixtureResponse | string>;

export type FixtureRoutes = Record<string, FixtureResponse | FixtureHandler | string>;

export type FixtureServer = {
  url: string;
  close(): Promise<void>;
};

const CLOSE_TIMEOUT_MS = 5_000;
const closePromises = new WeakMap<Stagehand, Promise<void>>();

export async function createStagehand(options?: {
  browser?: LocalBrowserLaunchOptions;
  model?: ClientLLM;
}): Promise<Stagehand> {
  // The integration suite is always headless; callers may customize other launch options.
  const browser = await localBrowser.launch({ ...options?.browser, headless: true });
  try {
    return await Stagehand.create({
      browser,
      model: options?.model ?? {
        generate: async (): Promise<LLMGenerateResult> => ({
          role: "assistant",
          content: { type: "text", text: "The integration test stub model was not configured" },
          outputFormat: "text",
        }),
      },
      logging: {
        level: "off",
      },
    });
  } catch (error) {
    await Promise.resolve(browser.close()).catch(() => {});
    throw error;
  }
}

export function closeStagehand(stagehand?: Stagehand | null): Promise<void> {
  if (!stagehand) return Promise.resolve();

  const pending = closePromises.get(stagehand);
  if (pending) return pending;

  const close = settleWithTimeout(
    stagehand.close().finally(() => stagehand.browser.close()),
    CLOSE_TIMEOUT_MS,
  );
  closePromises.set(stagehand, close);
  return close;
}

/**
 * First existing page, or a fresh one. Every integration spec needs this, and writing it
 * inline invites dropping the `await` on the now-async `context.pages()` -- which yields a
 * truthy Promise and a silently passing test rather than a type error.
 */
export async function firstPage(stagehand: Stagehand) {
  const pages = await stagehand.browser.context.pages();
  return pages[0] ?? (await stagehand.browser.context.newPage());
}

export async function startFixtureServer(
  routesOrHtml: FixtureRoutes | FixtureHandler | string,
): Promise<FixtureServer> {
  const routes =
    typeof routesOrHtml === "string"
      ? ({ "/": routesOrHtml } satisfies FixtureRoutes)
      : typeof routesOrHtml === "function"
        ? ({ "*": routesOrHtml } satisfies FixtureRoutes)
        : routesOrHtml;
  const server = createServer((request, response) => {
    void handleRequest(routes, request, response).catch((error: unknown) => {
      if (response.headersSent) {
        response.destroy(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      response.end(error instanceof Error ? error.message : String(error));
    });
  });

  await listen(server);
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Fixture server did not bind to a TCP port");
  }

  let closePromise: Promise<void> | undefined;
  return {
    url: `http://127.0.0.1:${address.port}/`,
    close: () => {
      closePromise ??= closeServer(server);
      return closePromise;
    },
  };
}

async function handleRequest(
  routes: FixtureRoutes,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const pathname = new URL(request.url ?? "/", "http://fixture.invalid").pathname;
  const route = routes[pathname] ?? routes["*"];
  if (route === undefined) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("not found");
    return;
  }

  const result = typeof route === "function" ? await route(request) : route;
  const fixtureResponse = typeof result === "string" ? { body: result } : result;
  response.writeHead(fixtureResponse.status ?? 200, {
    "content-type": "text/html; charset=utf-8",
    ...fixtureResponse.headers,
  });
  response.end(fixtureResponse.body ?? "");
}

function listen(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
    server.closeAllConnections();
  });
}

async function settleWithTimeout(promise: Promise<unknown>, timeoutMs: number): Promise<void> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timeoutId = setTimeout(resolve, timeoutMs);
  });

  try {
    await Promise.race([promise.catch(() => {}), timeout]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}
