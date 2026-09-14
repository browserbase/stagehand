import { createRequire } from "node:module";
import path from "node:path";
import type { ReadStream } from "node:fs";
import { fileURLToPath } from "node:url";

type BrowserbaseConstructor = new (options: { apiKey: string }) => {
  extensions: {
    create: (payload: { file: ReadStream }) => Promise<{ id: string }>;
    delete: (
      extensionId: string,
      options?: { headers?: Record<string, string | null> },
    ) => Promise<unknown>;
  };
  sessions: {
    create: (payload: Record<string, unknown>) => Promise<unknown>;
    update: (sessionId: string, payload: Record<string, unknown>) => Promise<unknown>;
    debug?: (sessionId: string) => Promise<unknown>;
  };
};

type WsModule = {
  new (
    url: string,
    options?: Record<string, unknown>,
  ): {
    on: (event: string, listener: (...args: unknown[]) => void) => void;
    once: (event: string, listener: (...args: unknown[]) => void) => void;
    send: (data: string, cb?: (error?: Error) => void) => void;
    close: () => void;
    readyState: number;
  };
  OPEN?: number;
};

// Resolve from this package's own dependency tree. Lazy requires keep these
// CommonJS dependencies out of surfaces that never touch Browserbase or raw CDP.
const evalsRequire = createRequire(import.meta.url);

export function resolveStagehandExtensionArchivePath(): string {
  const stagehandEntry = fileURLToPath(import.meta.resolve("@browserbasehq/stagehand"));
  return path.join(path.dirname(stagehandEntry), "assets", "stagehand-extension.zip");
}

export function loadBrowserbaseSdk(): BrowserbaseConstructor {
  const module = evalsRequire("@browserbasehq/sdk") as {
    default?: BrowserbaseConstructor;
  } & BrowserbaseConstructor;
  return module.default ?? (module as BrowserbaseConstructor);
}

export function loadWsModule(): WsModule {
  const module = evalsRequire("ws") as {
    default?: WsModule;
  } & WsModule;
  return module.default ?? (module as WsModule);
}
