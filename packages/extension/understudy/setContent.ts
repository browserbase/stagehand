import type { Protocol } from "devtools-protocol";
import type { LoadState } from "@browserbasehq/stagehand-protocol/types";
import type { Page } from "./page.js";
import { runWithProgress } from "./progress.js";

const LIFECYCLE_EVENT: Record<LoadState, string> = {
  domcontentloaded: "DOMContentLoaded",
  load: "load",
  networkidle: "networkIdle",
};

/** Replace the document and wait for its lifecycle, not the previous document's. */
export async function setContent(
  page: Page,
  html: string,
  options?: { waitUntil?: LoadState; timeout?: number },
): Promise<void> {
  await runWithProgress(
    { name: "setContent", timeout: options?.timeout ?? 30_000 },
    async (progress) => {
      const session = page.mainSession;
      const frameId = page.mainFrameId();
      await progress.run("enabling lifecycle events", () =>
        session.send("Page.setLifecycleEventsEnabled", { enabled: true }),
      );

      let started = false;
      const lifecycle = Promise.withResolvers<void>();
      const wanted = LIFECYCLE_EVENT[options?.waitUntil ?? "load"];
      const onLifecycle = (event: Protocol.Page.LifecycleEventEvent) => {
        if (event.frameId !== frameId) return;
        // document.open() resets lifecycle state without changing the loader id.
        if (event.name === "init") started = true;
        if (started && event.name === wanted) lifecycle.resolve();
      };
      const onFrameNavigated = (event: Protocol.Page.FrameNavigatedEvent) => {
        if (event.frame.id === frameId) {
          lifecycle.reject(new Error("setContent was interrupted by navigation"));
        }
      };
      const onFrameDetached = (event: Protocol.Page.FrameDetachedEvent) => {
        if (event.frameId === frameId) lifecycle.reject(new Error("setContent frame was detached"));
      };
      const onTargetDetached = (event: Protocol.Target.DetachedFromTargetEvent) => {
        if (event.sessionId === session.id)
          lifecycle.reject(new Error("setContent page was closed"));
      };
      const onTransportClosed = (reason: string) => {
        lifecycle.reject(new Error(`setContent connection closed: ${reason}`));
      };

      session.on("Page.lifecycleEvent", onLifecycle);
      session.on("Page.frameNavigated", onFrameNavigated);
      session.on("Page.frameDetached", onFrameDetached);
      page.conn.on("Target.detachedFromTarget", onTargetDetached);
      page.conn.onTransportClosed(onTransportClosed);
      try {
        // Attach the wait before sending: an inline document can finish loading
        // before Page.setDocumentContent responds.
        await progress.run("waiting for document content", async () => {
          await Promise.all([
            lifecycle.promise,
            session.send("Page.setDocumentContent", { frameId, html }),
          ]);
        });
      } finally {
        session.off("Page.lifecycleEvent", onLifecycle);
        session.off("Page.frameNavigated", onFrameNavigated);
        session.off("Page.frameDetached", onFrameDetached);
        page.conn.off("Target.detachedFromTarget", onTargetDetached);
        page.conn.offTransportClosed(onTransportClosed);
      }
    },
  );
}
