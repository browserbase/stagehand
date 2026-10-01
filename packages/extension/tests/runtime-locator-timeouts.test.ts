import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StagehandMethods } from "@browserbasehq/stagehand-protocol/schema-registry";
import { DEFAULT_LOCATOR_TIMEOUT_MS } from "@browserbasehq/stagehand-protocol/schemas";
import { createStagehandRuntime, type UnderstudyRuntimeLocator } from "../runtime.js";
import { Progress } from "../understudy/progress.js";

const methods = Object.entries(StagehandMethods).filter(([, method]) =>
  method.name.startsWith("locator."),
);
const fields: Record<string, Record<string, unknown>> = {
  locatorFill: { value: "hello" },
  locatorType: { text: "hello" },
  locatorScrollTo: { percent: 50 },
  locatorSelectOption: { values: "a" },
  locatorSetInputFiles: { files: [{ name: "hello.txt", data: "aGVsbG8=" }] },
};

describe("runtime locator deadlines", () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] }));
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe.each(methods)("%s", (key, method) => {
    it.each([undefined, {}, { timeout: 50 }, { timeout: 0 }])(
      "owns a deadline before resolution with options %j",
      async (options) => {
        const runtime = createStagehandRuntime();
        let progress: Progress | undefined;
        let complete!: () => void;
        const work = new Promise<void>((resolve) => {
          complete = resolve;
        });
        const actionName = key.slice("locator".length);
        const action = vi.fn((...args: unknown[]) => {
          progress = args.at(-1) as Progress;
          expect(progress).toBeInstanceOf(Progress);
          expect(progress.name).toBe(method.name);
          return work;
        });
        const budget = options?.timeout ?? DEFAULT_LOCATOR_TIMEOUT_MS;
        vi.spyOn(runtime, "resolveLocator").mockImplementation(() => {
          expect(vi.getTimerCount()).toBe(budget === 0 ? 0 : 1);
          // Resolution has already spent part of this call's budget.
          vi.advanceTimersByTime(10);
          return {
            [actionName[0]!.toLowerCase() + actionName.slice(1)]: action,
          } as unknown as UnderstudyRuntimeLocator;
        });
        const invoke = runtime[key as keyof typeof runtime] as (
          params: unknown,
        ) => Promise<unknown>;
        const pending = invoke.call(runtime, {
          pageId: "page-1",
          selector: "iframe >> button",
          ...fields[key],
          ...(options ? { options } : {}),
        });
        const observed = pending.catch((error: unknown) => error);
        await vi.advanceTimersByTimeAsync(0);
        expect(action).toHaveBeenCalledOnce();
        expect(progress!.remainingMs()).toBe(budget === 0 ? Infinity : budget - 10);
        if (budget === 0) {
          await vi.advanceTimersByTimeAsync(DEFAULT_LOCATOR_TIMEOUT_MS + 1);
          expect(progress!.signal.aborted).toBe(false);
          complete();
          await pending;
        } else {
          await vi.advanceTimersByTimeAsync(budget - 11);
          expect(progress!.signal.aborted).toBe(false);
          await vi.advanceTimersByTimeAsync(1);
          expect(await observed).toMatchObject({
            name: "TimeoutError",
            message: expect.stringContaining(method.name),
          });
          expect(progress!.signal.aborted).toBe(true);
          complete();
        }
        await vi.advanceTimersByTimeAsync(0);
        expect(vi.getTimerCount()).toBe(0);
      },
    );
  });
});
