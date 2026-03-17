import type { EventStore } from "../../../lib/v3/flowlogger/EventStore.js";
import { EventEmitterWithWildcardSupport } from "../../../lib/v3/flowlogger/EventEmitter.js";
import { FlowEvent } from "../../../lib/v3/flowlogger/FlowLogger.js";

export function waitForAsyncEmit(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export function attachEventStoreToBus(
  store: EventStore,
  bus: EventEmitterWithWildcardSupport,
): () => void {
  const onFlowEvent = (event: unknown) => {
    if (event instanceof FlowEvent) {
      void store.emit(event);
    }
  };

  bus.on("*", onFlowEvent);
  return () => {
    bus.off("*", onFlowEvent);
  };
}
