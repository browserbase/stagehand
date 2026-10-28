import type { Protocol } from "devtools-protocol";
import type { LoadState, PageSetContentOptions } from "@browserbasehq/stagehand-protocol/types";
import type { Page } from "./page.js";
import { runWithProgress } from "./progress.js";

const LIFECYCLE_EVENT: Record<LoadState, string> = {
  domcontentloaded: "DOMContentLoaded",
  load: "load",
  networkidle: "networkIdle",
};

const activeReplacements = new WeakSet<Page>();

/** Replace the document and wait for its lifecycle, not the previous document's. */
export async function setContent(
  page: Page,
  html: string,
  options?: PageSetContentOptions,
): Promise<void> {
  if (activeReplacements.has(page)) {
    throw new Error("Another setContent call is still in progress on this page");
  }
  activeReplacements.add(page);
  let mutation: Promise<unknown> | undefined;
  try {
    await runWithProgress(
      { name: "setContent", timeout: options?.timeout ?? 30_000 },
      async (progress) => {
        const session = page.mainSession;
        const frameId = page.mainFrameId();
        let started = false;
        let interruption: Error | undefined;
        const lifecycle = Promise.withResolvers<void>();
        // Closure can race the deadline before the next Progress callback starts.
        void lifecycle.promise.catch(() => {});
        const interrupt = (error: Error) => {
          interruption ??= error;
          lifecycle.reject(interruption);
        };
        const wanted = LIFECYCLE_EVENT[options?.waitUntil ?? "load"];
        const onLifecycle = (event: Protocol.Page.LifecycleEventEvent) => {
          if (event.frameId !== frameId) return;
          // document.open() resets lifecycle state without changing the loader id.
          if (event.name === "init") started = true;
          if (started && event.name === wanted) lifecycle.resolve();
        };
        const onFrameNavigated = (event: Protocol.Page.FrameNavigatedEvent) => {
          if (event.frame.id === frameId) {
            interrupt(new Error("setContent was interrupted by navigation"));
          }
        };
        const onFrameDetached = (event: Protocol.Page.FrameDetachedEvent) => {
          if (event.frameId === frameId) interrupt(new Error("setContent frame was detached"));
        };
        const onTargetDetached = (event: Protocol.Target.DetachedFromTargetEvent) => {
          if (event.sessionId === session.id) interrupt(new Error("setContent page was closed"));
        };
        const onTargetDestroyed = (event: Protocol.Target.TargetDestroyedEvent) => {
          if (event.targetId === page.targetId())
            interrupt(new Error("setContent page was closed"));
        };
        const onTransportClosed = (reason: string) => {
          interrupt(new Error(`setContent connection closed: ${reason}`));
        };

        session.on("Page.frameNavigated", onFrameNavigated);
        session.on("Page.frameDetached", onFrameDetached);
        page.conn.on("Target.detachedFromTarget", onTargetDetached);
        page.conn.on("Target.targetDestroyed", onTargetDestroyed);
        page.conn.onTransportClosed(onTransportClosed);
        try {
          await progress.run("enabling lifecycle events", () => {
            if (interruption) throw interruption;
            if (!page.conn.connected) throw new Error("setContent connection is closed");
            return Promise.race([
              lifecycle.promise,
              session.send("Page.setLifecycleEventsEnabled", { enabled: true }),
            ]);
          });
          // Enabling events can replay the previous document's lifecycle.
          session.on("Page.lifecycleEvent", onLifecycle);
          // Attach the wait before sending: an inline document can finish loading
          // before Page.setDocumentContent responds.
          await progress.run("waiting for document content", async () => {
            mutation = Promise.resolve().then(() => {
              progress.throwIfStopped();
              if (interruption) throw interruption;
              if (!page.conn.connected) throw new Error("setContent connection is closed");
              return session.send("Page.setDocumentContent", { frameId, html });
            });
            await Promise.all([lifecycle.promise, mutation]);
          });
        } finally {
          session.off("Page.lifecycleEvent", onLifecycle);
          session.off("Page.frameNavigated", onFrameNavigated);
          session.off("Page.frameDetached", onFrameDetached);
          page.conn.off("Target.detachedFromTarget", onTargetDetached);
          page.conn.off("Target.targetDestroyed", onTargetDestroyed);
          page.conn.offTransportClosed(onTransportClosed);
        }
      },
    );
  } finally {
    // CDP cannot cancel a command already sent. Keep the page guarded until a
    // timed-out mutation acknowledges, so it cannot overwrite a later call.
    if (mutation)
      void mutation.then(
        () => activeReplacements.delete(page),
        () => activeReplacements.delete(page),
      );
    else activeReplacements.delete(page);
  }
}
