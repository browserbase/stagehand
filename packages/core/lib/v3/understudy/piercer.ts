import type { Protocol } from "devtools-protocol";
import { v3Logger } from "@/packages/core/lib/v3/logger";
import type { CDPSessionLike } from "./cdp";
import { v3ScriptContent } from "../dom/build/scriptV3Content";

export async function installV3PiercerIntoSession(
  session: CDPSessionLike,
): Promise<void> {
  await session.send("Page.enable").catch(() => {});
  await session.send("Runtime.enable").catch(() => {});
  try {
    await session.send<Protocol.Page.AddScriptToEvaluateOnNewDocumentResponse>(
      "Page.addScriptToEvaluateOnNewDocument",
      { source: v3ScriptContent, runImmediately: true },
    );
  } catch (e) {
    const msg = String((e as Error)?.message ?? e ?? "");
    // If the session vanished during attach (common with short‑lived OOPIFs),
    // swallow and return; re‑installs will happen on future sessions/loads.
    if (msg.includes("Session with given id not found")) return;
    // For other errors, keep going but don't throw — the next evaluate is idempotent.
  }
  await session
    .send<Protocol.Runtime.EvaluateResponse>("Runtime.evaluate", {
      expression: v3ScriptContent,
      returnByValue: true,
      awaitPromise: true,
    })
    .catch(() => {});
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
