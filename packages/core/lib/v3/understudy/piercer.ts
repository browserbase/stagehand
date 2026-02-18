import type { Protocol } from "devtools-protocol";
import { v3Logger } from "../logger.js";
import type { CDPSessionLike } from "./cdp.js";
import { v3ScriptContent } from "../dom/build/scriptV3Content.js";
import { reRenderScriptContent } from "../dom/build/reRenderScriptContent.js";

export async function installV3PiercerIntoSession(
  session: CDPSessionLike,
): Promise<boolean> {
  const pageEnabled = await session
    .send("Page.enable")
    .then(() => true)
    .catch(() => false);
  if (!pageEnabled) return false;

  await session.send("Runtime.enable").catch(() => {});
  try {
    await session.send<Protocol.Page.AddScriptToEvaluateOnNewDocumentResponse>(
      "Page.addScriptToEvaluateOnNewDocument",
      { source: v3ScriptContent, runImmediately: true },
    );
  } catch (e) {
    const msg = String((e as Error)?.message ?? e ?? "");
    // If the session vanished during attach (common with short-lived OOPIFs),
    // swallow and report failure so callers can early-return.
    if (msg.includes("Session with given id not found")) return false;
    // For other errors, keep going but don't throw — the next evaluate is idempotent.
  }
  await session
    .send<Protocol.Runtime.EvaluateResponse>("Runtime.evaluate", {
      expression: v3ScriptContent,
      returnByValue: true,
      awaitPromise: true,
    })
    .catch(() => {});

  // After the piercer is in place, re-render any custom elements whose
  // shadow roots were created before we patched attachShadow so their
  // closed roots are recreated under the hook.
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
