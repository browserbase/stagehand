import { locatorScripts } from "./dom/locatorScripts/registry.js";
import { setAgentIndicatorActive } from "./dom/agentIndicator.js";
import {
  createAgentIndicatorBootstrapGuard,
  handleAgentIndicatorSetMessage,
  isAgentIndicatorSetMessage,
  type AgentIndicatorPaintResponse,
} from "./dom/agentIndicatorMessaging.js";

declare const __STAGEHAND_AGENT_INDICATOR_SET_MESSAGE__: string;
declare const __STAGEHAND_AGENT_INDICATOR_GET_MESSAGE__: string;

type StagehandExtensionWorldGlobal = typeof globalThis & {
  __stagehandExtensionWorld?: {
    name: "stagehand";
    version: "stagehand.v4";
  };
  __stagehandLocatorWorld?: {
    kind: "extension" | "cdp-fallback";
    closedShadowRoots: boolean;
  };
  __stagehandLocatorScripts?: typeof locatorScripts;
};

const scope = globalThis as StagehandExtensionWorldGlobal;

if (!scope.__stagehandExtensionWorld) {
  Object.defineProperty(scope, "__stagehandExtensionWorld", {
    configurable: false,
    enumerable: false,
    writable: false,
    value: Object.freeze({
      name: "stagehand",
      version: "stagehand.v4",
    }),
  });
}

if (!scope.__stagehandLocatorScripts) {
  Object.defineProperty(scope, "__stagehandLocatorScripts", {
    configurable: false,
    enumerable: false,
    writable: false,
    value: locatorScripts,
  });
}

if (!scope.__stagehandLocatorWorld) {
  const closedShadowRoots = typeof globalThis.chrome?.dom?.openOrClosedShadowRoot === "function";
  Object.defineProperty(scope, "__stagehandLocatorWorld", {
    configurable: false,
    enumerable: false,
    writable: false,
    value: Object.freeze({
      kind: closedShadowRoots ? "extension" : "cdp-fallback",
      closedShadowRoots,
    }),
  });
}

const extensionRuntime = globalThis.chrome?.runtime;
const agentIndicatorBootstrap = createAgentIndicatorBootstrapGuard();

if (window.top === window && extensionRuntime?.onMessage) {
  extensionRuntime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    if (isAgentIndicatorSetMessage(message, __STAGEHAND_AGENT_INDICATOR_SET_MESSAGE__)) {
      agentIndicatorBootstrap.markSetReceived();
    }
    return handleAgentIndicatorSetMessage(
      message,
      __STAGEHAND_AGENT_INDICATOR_SET_MESSAGE__,
      setAgentIndicatorActive,
      respondAfterIndicatorPaint,
      sendResponse,
    );
  });
  void extensionRuntime
    .sendMessage({ type: __STAGEHAND_AGENT_INDICATOR_GET_MESSAGE__ })
    .then((response: unknown) => {
      if (response && typeof response === "object") {
        const active = Reflect.get(response, "active");
        if (typeof active === "boolean") {
          agentIndicatorBootstrap.apply(active, setAgentIndicatorActive);
        }
      }
    })
    .catch(() => {});
}

function respondAfterIndicatorPaint(
  sendResponse: (response: AgentIndicatorPaintResponse) => void,
): void {
  let responded = false;
  const respond = () => {
    if (responded) return;
    responded = true;
    sendResponse({ painted: true });
  };

  requestAnimationFrame(() => requestAnimationFrame(respond));
  globalThis.setTimeout(respond, 100);
}
