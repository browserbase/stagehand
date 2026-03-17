import { EventEmitter } from "node:events";

type WildcardEventListener = (...args: unknown[]) => void;

export class EventEmitterWithWildcardSupport extends EventEmitter {
  private readonly wildcardListeners = new Set<WildcardEventListener>();

  override on(
    eventName: string | symbol,
    listener: (...args: unknown[]) => void,
  ): this {
    if (eventName === "*") {
      this.wildcardListeners.add(listener);
      return this;
    }

    return super.on(eventName, listener);
  }

  override off(
    eventName: string | symbol,
    listener: (...args: unknown[]) => void,
  ): this {
    if (eventName === "*") {
      this.wildcardListeners.delete(listener);
      return this;
    }

    return super.off(eventName, listener);
  }

  override emit(eventName: string | symbol, ...args: unknown[]): boolean {
    const handled = super.emit(eventName, ...args);

    for (const listener of this.wildcardListeners) {
      listener(...args);
    }

    return handled || this.wildcardListeners.size > 0;
  }
}
