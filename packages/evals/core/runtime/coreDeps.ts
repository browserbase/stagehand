import path from "node:path";
import { createRequire } from "node:module";
import { getRepoRootDir } from "../../runtimePaths.js";

type BrowserbaseConstructor = new (options: { apiKey: string }) => {
  sessions: {
    create: (payload: Record<string, unknown>) => Promise<unknown>;
    update: (
      sessionId: string,
      payload: Record<string, unknown>,
    ) => Promise<unknown>;
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

let coreRequire: ReturnType<typeof createRequire> | null = null;

function requireFromCorePackage(specifier: string): unknown {
  if (!coreRequire) {
    const packageJsonPath = path.join(
      getRepoRootDir(),
      "packages",
      "core",
      "package.json",
    );
    coreRequire = createRequire(packageJsonPath);
  }

  return coreRequire(specifier);
}

export function loadBrowserbaseSdk(): BrowserbaseConstructor {
  const module = requireFromCorePackage("@browserbasehq/sdk") as {
    default?: BrowserbaseConstructor;
  } & BrowserbaseConstructor;
  return module.default ?? (module as BrowserbaseConstructor);
}

export function loadWsModule(): WsModule {
  const module = requireFromCorePackage("ws") as {
    default?: WsModule;
  } & WsModule;
  return module.default ?? (module as WsModule);
}
