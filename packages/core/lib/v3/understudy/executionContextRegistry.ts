import type { Protocol } from "devtools-protocol";
import type { CDPSessionLike } from "./cdp.js";

type FrameId = Protocol.Page.FrameId;
type ExecId = Protocol.Runtime.ExecutionContextId;

export class ExecutionContextRegistry {
  private readonly byFrame = new WeakMap<
    CDPSessionLike,
    Map<FrameId, ExecId>
  >();
  private readonly byExec = new WeakMap<CDPSessionLike, Map<ExecId, FrameId>>();

  /** Wire listeners for this session. Call BEFORE Runtime.enable. */
  attachSession(session: CDPSessionLike): void {
    const onCreated = (
      evt: Protocol.Runtime.ExecutionContextCreatedEvent,
    ): void => {
      const aux = (evt.context.auxData ?? {}) as {
        frameId?: string;
        isDefault?: boolean;
      };
      if (aux.isDefault === true && typeof aux.frameId === "string") {
        this.register(session, aux.frameId as FrameId, evt.context.id);
      }
    };
    const onDestroyed = (
      evt: Protocol.Runtime.ExecutionContextDestroyedEvent,
    ): void => {
      const rev = this.byExec.get(session);
      const fwd = this.byFrame.get(session);
      if (!rev || !fwd) return;
      const frameId = rev.get(evt.executionContextId);
      if (!frameId) return;
      rev.delete(evt.executionContextId);
      if (fwd.get(frameId) === evt.executionContextId) fwd.delete(frameId);
    };
    const onCleared = (): void => {
      this.byFrame.delete(session);
      this.byExec.delete(session);
    };

    session.on("Runtime.executionContextCreated", onCreated);
    session.on("Runtime.executionContextDestroyed", onDestroyed);
    session.on("Runtime.executionContextsCleared", onCleared);
  }

  getMainWorld(session: CDPSessionLike, frameId: FrameId): ExecId | null {
    return this.byFrame.get(session)?.get(frameId) ?? null;
  }

  async waitForMainWorld(
    session: CDPSessionLike,
    frameId: FrameId,
    timeoutMs: number = 800,
  ): Promise<ExecId> {
    const cached = this.getMainWorld(session, frameId);
    if (cached) return cached;

    await session.send("Runtime.enable").catch(() => {});
    const after = this.getMainWorld(session, frameId);
    if (after) return after;

    return await new Promise<ExecId>((resolve, reject) => {
      let done = false;
      const onCreated = (
        evt: Protocol.Runtime.ExecutionContextCreatedEvent,
      ): void => {
        const aux = (evt.context.auxData ?? {}) as {
          frameId?: string;
          isDefault?: boolean;
        };
        if (aux.isDefault === true && aux.frameId === frameId) {
          this.register(session, frameId, evt.context.id);
          if (!done) {
            done = true;
            clearTimeout(timer);
            session.off("Runtime.executionContextCreated", onCreated);
            resolve(evt.context.id);
          }
        }
      };
      const timer = setTimeout(() => {
        if (!done) {
          done = true;
          session.off("Runtime.executionContextCreated", onCreated);
          reject(new Error(`main world not ready for frame ${frameId}`));
        }
      }, timeoutMs);
      session.on("Runtime.executionContextCreated", onCreated);
    });
  }

  private register(
    session: CDPSessionLike,
    frameId: FrameId,
    ctxId: ExecId,
  ): void {
    let fwd = this.byFrame.get(session);
    if (!fwd) {
      fwd = new Map<FrameId, ExecId>();
      this.byFrame.set(session, fwd);
    }
    let rev = this.byExec.get(session);
    if (!rev) {
      rev = new Map<ExecId, FrameId>();
      this.byExec.set(session, rev);
    }
    fwd.set(frameId, ctxId);
    rev.set(ctxId, frameId);
  }
}

export const executionContexts = new ExecutionContextRegistry();
