import { EventBus } from "../lib/bubus.js";

import { getSessionStore } from "../lib/sessionStoreManager.js";
import type { SessionStore } from "../lib/SessionStore.js";
import { resolveV4ServiceConfig, type V4ServiceConfig } from "./config.js";
import { V4State } from "./state.js";
import { AgentService } from "./services/AgentService.js";
import { BrowserbaseBrowserService } from "./services/browser/BrowserbaseBrowserService.js";
import { LocalBrowserService } from "./services/browser/LocalBrowserService.js";
import { RemoteCdpBrowserService } from "./services/browser/RemoteCdpBrowserService.js";
import { type ServiceDeps } from "./services/base.js";
import { StagehandService } from "./services/StagehandService.js";
import { SessionService } from "./services/SessionService.js";
import { AisdkLLMService, CustomLLMService } from "./services/LLMService.js";
import { LocalUnderstudyService } from "./services/understudy/LocalUnderstudyService.js";
import { RemoteUnderstudyService } from "./services/understudy/RemoteUnderstudyService.js";

export interface V4Runtime {
  state: V4State;
  sessionStore: SessionStore;
  config: V4ServiceConfig;
}

export interface V4RequestRuntime extends V4Runtime {
  bus: EventBus;
}

let runtime: V4Runtime | null = null;

function registerServices(deps: ServiceDeps, config: V4ServiceConfig): void {
  const browserConstructors: Record<V4ServiceConfig["browserMode"], () => void> = {
    local: () => {
      new LocalBrowserService(deps);
    },
    "remote-cdp": () => {
      new RemoteCdpBrowserService(deps);
    },
    browserbase: () => {
      new BrowserbaseBrowserService(deps);
    },
  };
  browserConstructors[config.browserMode]();

  new SessionService(deps);
  const llmConstructors: Record<V4ServiceConfig["llmMode"], () => void> = {
    aisdk: () => {
      new AisdkLLMService(deps);
    },
    custom: () => {
      new CustomLLMService(deps);
    },
  };
  llmConstructors[config.llmMode]();
  new StagehandService(deps);
  new AgentService(deps);

  const understudyConstructors: Record<V4ServiceConfig["understudyMode"], () => void> = {
    local: () => {
      new LocalUnderstudyService(deps);
    },
    remote: () => {
      new RemoteUnderstudyService(deps, config);
    },
  };

  understudyConstructors[config.understudyMode]();
}

export function initializeV4Runtime(): V4Runtime {
  if (runtime) {
    return runtime;
  }

  const state = new V4State();
  const config = resolveV4ServiceConfig();
  const sessionStore = getSessionStore();

  runtime = {
    state,
    sessionStore,
    config,
  };

  return runtime;
}

export function getV4Runtime(): V4Runtime {
  if (!runtime) {
    throw new Error("V4 runtime has not been initialized");
  }

  return runtime;
}

export function createV4RequestRuntime(requestId?: string): V4RequestRuntime {
  const base = getV4Runtime();
  const bus = new EventBus(
    requestId ? `StagehandServerV4Request#${requestId}` : "StagehandServerV4Request",
    {
      event_handler_completion: "first",
    },
  );

  const deps: ServiceDeps = {
    bus,
    state: base.state,
    sessionStore: base.sessionStore,
  };

  registerServices(deps, base.config);

  return {
    ...base,
    bus,
  };
}

export async function emitV4Event<TResult>(
  bus: EventBus,
  event: unknown,
): Promise<TResult> {
  const emitted = bus.emit(event as any);
  await emitted.done();
  return emitted.event_result as TResult;
}
