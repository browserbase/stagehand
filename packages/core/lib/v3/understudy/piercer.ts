import type { Protocol } from "devtools-protocol";
import { v3Logger } from "../logger";
import type { CDPSessionLike } from "./cdp";
import { v3ScriptContent } from "../dom/build/scriptV3Content";
import { reRenderScriptContent } from "../dom/build/reRenderScriptContent";
import { executionContexts } from "./executionContextRegistry";
import { installNetworkInjector } from "./networkInjector";

/** Whether to use network interception for script injection (more stealthy) */
const USE_NETWORK_INJECTION = true;

export async function installV3PiercerIntoSession(
  session: CDPSessionLike,
): Promise<boolean> {
  // Use ensureDomainEnabled to track state and avoid redundant enables
  await executionContexts.ensureDomainEnabled(session, "Page");
  if (!executionContexts.isDomainEnabled(session, "Page")) return false;

  if (USE_NETWORK_INJECTION) {
    // Use network interception to inject scripts into HTML responses
    // This is stealthier than addScriptToEvaluateOnNewDocument
    try {
      await installNetworkInjector(session, {
        additionalScripts: [reRenderScriptContent],
      });
    } catch (e) {
      const msg = String((e as Error)?.message ?? e ?? "");
      if (msg.includes("Session with given id not found")) return false;
      // Fall through to legacy approach
    }
  }

  // Also use addScriptToEvaluateOnNewDocument as a fallback for:
  // - about:blank and other non-HTTP pages
  // - Pages that load before network interception is ready
  try {
    await session.send<Protocol.Page.AddScriptToEvaluateOnNewDocumentResponse>(
      "Page.addScriptToEvaluateOnNewDocument",
      { source: v3ScriptContent, runImmediately: true },
    );
  } catch (e) {
    const msg = String((e as Error)?.message ?? e ?? "");
    if (msg.includes("Session with given id not found")) return false;
  }

  // Inject into current document immediately
  await session
    .send<Protocol.Runtime.EvaluateResponse>("Runtime.evaluate", {
      expression: v3ScriptContent,
      returnByValue: true,
      awaitPromise: true,
    })
    .catch(() => {});

  // Re-render any custom elements whose shadow roots were created before patching
  await session
    .send<Protocol.Runtime.EvaluateResponse>("Runtime.evaluate", {
      expression: reRenderScriptContent,
      returnByValue: true,
      awaitPromise: false,
    })
    .catch(() => {});

  return true;
}

/** (Optional) stream patch logs in your node console during bring-up */
export function tapPiercerConsole(
  session: CDPSessionLike,
  label: string,
): void {
  session.on<Protocol.Runtime.ConsoleAPICalledEvent>(
    "Runtime.consoleAPICalled",
    (evt) => {
      const head = evt.args?.[0]?.value as string | undefined;
      if (head?.startsWith?.("[v3-piercer]")) {
        v3Logger({
          category: "piercer",
          message: `[${label}] ${head}`,
          level: 2,
          auxiliary: {
            value: {
              value: String(evt.args?.[1]?.value ?? ""),
              type: "string",
            },
          },
        });
      }
    },
  );
}
