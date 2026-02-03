import type { Protocol } from "devtools-protocol";
import { v3Logger } from "../logger";
import type { CDPSessionLike } from "./cdp";
import { v3ScriptContent } from "../dom/build/scriptV3Content";
import { reRenderScriptContent } from "../dom/build/reRenderScriptContent";
import { executionContexts } from "./executionContextRegistry";

export async function installV3PiercerIntoSession(
  session: CDPSessionLike,
): Promise<boolean> {
  if (!session) return false;
  await session.send("Runtime.enable").catch(() => {});

  const deferRerender = `(() => {
    const run = () => { try { ${reRenderScriptContent} } catch {} };
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", run, { once: true });
    } else {
      run();
    }
  })();`;

  const installInFrame = async (frameId: Protocol.Page.FrameId) => {
    const ctxId = await executionContexts
      .waitForMainWorld(session, frameId)
      .catch(() => {});
    if (!ctxId) return;
    await session
      .send<Protocol.Runtime.EvaluateResponse>("Runtime.evaluate", {
        expression: v3ScriptContent,
        contextId: ctxId,
        returnByValue: true,
        awaitPromise: true,
      })
      .catch(() => {});
    await session
      .send<Protocol.Runtime.EvaluateResponse>("Runtime.evaluate", {
        expression: deferRerender,
        contextId: ctxId,
        returnByValue: true,
        awaitPromise: false,
      })
      .catch(() => {});
  };

  session.on<Protocol.Page.FrameNavigatedEvent>(
    "Page.frameNavigated",
    (evt) => {
      void installInFrame(evt.frame.id);
    },
  );

  try {
    const { frameTree } =
      await session.send<Protocol.Page.GetFrameTreeResponse>(
        "Page.getFrameTree",
      );
    const visit = (tree: Protocol.Page.FrameTree) => {
      void installInFrame(tree.frame.id);
      tree.childFrames?.forEach(visit);
    };
    visit(frameTree);
  } catch {
    // ignore if the session vanished during attach
  }

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
