import type { Protocol } from "devtools-protocol";
import type { CDPSessionLike } from "./cdp";
import { v3ScriptContent } from "../dom/build/scriptV3Content";

export async function installV3PiercerIntoSession(
  session: CDPSessionLike,
): Promise<void> {
  await session.send("Page.enable").catch(() => {});
  await session.send("Runtime.enable").catch(() => {});
  await session.send<Protocol.Page.AddScriptToEvaluateOnNewDocumentResponse>(
    "Page.addScriptToEvaluateOnNewDocument",
    { source: v3ScriptContent },
  );
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
        console.log(`[piercer][${label}]`, head, evt.args?.[1]?.value ?? "");
      }
    },
  );
}
