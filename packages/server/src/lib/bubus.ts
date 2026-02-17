import * as bubusCjsNamespace from "/Users/squash/Local/Code/bu/bubus/bubus-ts/dist/cjs/index.js";
import * as bubusLoggingCjsNamespace from "/Users/squash/Local/Code/bu/bubus/bubus-ts/dist/cjs/logging.js";

const bubusSource =
  (bubusCjsNamespace as unknown as { default?: Record<string, unknown> }).default ??
  (bubusCjsNamespace as unknown as Record<string, unknown>);

export const EventBus = (
  bubusSource as { EventBus: new (...args: any[]) => any }
).EventBus;

export type EventBus = InstanceType<typeof EventBus>;

export const BaseEvent = (bubusSource as { BaseEvent: any }).BaseEvent;

export const retry = (bubusSource as {
  retry: (options: Record<string, unknown>) => any;
}).retry;

const bubusLoggingSource =
  (
    bubusLoggingCjsNamespace as unknown as { default?: Record<string, unknown> }
  ).default ??
  (bubusLoggingCjsNamespace as unknown as Record<string, unknown>);

export const logTree = (
  bubusLoggingSource as { logTree: (bus: EventBus) => string }
).logTree;
