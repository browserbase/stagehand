/**
 * Central Event Bus for Stagehand
 *
 * Single event emitter shared by:
 * - V3 class (LLM events, library events)
 * - StagehandServer (server lifecycle, request/response events)
 * - External listeners (cloud servers, monitoring, etc.)
 */

import { EventEmitter } from "events";
import type { StagehandServerEventMap } from "./events";

/**
 * Type-safe event bus for all Stagehand events
 */
export class StagehandEventBus extends EventEmitter {
  /**
   * Emit an event and wait for all async listeners to complete
   */
  async emitAsync<K extends keyof StagehandServerEventMap>(
    event: K,
    data: StagehandServerEventMap[K],
  ): Promise<void> {
    const listeners = this.listeners(event);
    await Promise.all(listeners.map((listener) => listener(data)));
  }

  /**
   * Type-safe event listener
   */
  on<K extends keyof StagehandServerEventMap>(
    event: K,
    listener: (data: StagehandServerEventMap[K]) => void | Promise<void>,
  ): this {
    return super.on(event, listener);
  }

  /**
   * Type-safe one-time event listener
   */
  once<K extends keyof StagehandServerEventMap>(
    event: K,
    listener: (data: StagehandServerEventMap[K]) => void | Promise<void>,
  ): this {
    return super.once(event, listener);
  }

  /**
   * Type-safe remove listener
   */
  off<K extends keyof StagehandServerEventMap>(
    event: K,
    listener: (data: StagehandServerEventMap[K]) => void | Promise<void>,
  ): this {
    return super.off(event, listener);
  }
}

/**
 * Create a new event bus instance
 */
export function createEventBus(): StagehandEventBus {
  return new StagehandEventBus();
}
