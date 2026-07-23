import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { LogLine, V3, V3Options } from "@browserbasehq/stagehand";
import { InMemorySessionStore } from "../../src/lib/InMemorySessionStore.js";
import type { CreateSessionParams } from "../../src/lib/SessionStore.js";

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (predicate()) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error("Timed out waiting for condition");
}

const sessionParams: CreateSessionParams = {
  browserType: "local",
  modelName: "openai/gpt-4.1-mini",
};

class FakeStagehand {
  readonly initCalls: number[] = [];
  readonly closeCalls: number[] = [];
  initGate: Promise<void> = Promise.resolve();
  closeGate: Promise<void> = Promise.resolve();

  constructor(readonly options: V3Options) {}

  async init(): Promise<void> {
    this.initCalls.push(Date.now());
    await this.initGate;
  }

  async close(): Promise<void> {
    this.closeCalls.push(Date.now());
    await this.closeGate;
  }

  emit(message: LogLine): void {
    this.options.logger?.(message);
  }
}

class TestSessionStore extends InMemorySessionStore {
  readonly instances: FakeStagehand[] = [];
  nextInitGate: Promise<void> = Promise.resolve();

  protected override createStagehand(options: V3Options): V3 {
    const stagehand = new FakeStagehand(options);
    stagehand.initGate = this.nextInitGate;
    this.instances.push(stagehand);
    return stagehand as unknown as V3;
  }
}

function logLine(message: string): LogLine {
  return {
    category: "test",
    message,
    level: 1,
  };
}

describe("InMemorySessionStore concurrency", () => {
  it("serializes concurrent creation of the same session", async () => {
    const store = new TestSessionStore();

    const results = await Promise.allSettled([
      store.createSession("session", sessionParams),
      store.createSession("session", sessionParams),
    ]);

    assert.equal(
      results.filter((result) => result.status === "fulfilled").length,
      1,
    );
    assert.equal(
      results.filter((result) => result.status === "rejected").length,
      1,
    );
    assert.equal(store.size, 1);
    await store.destroy();
  });

  it("shares one initialization across concurrent requests", async () => {
    const store = new TestSessionStore();
    const init = deferred();
    store.nextInitGate = init.promise;
    await store.createSession("session", sessionParams);

    const first = store.getOrCreateStagehand("session", {});
    const second = store.getOrCreateStagehand("session", {});

    await waitFor(() => store.instances.length === 1);
    assert.equal(store.instances[0].initCalls.length, 1);

    init.resolve();
    const [firstStagehand, secondStagehand] = await Promise.all([
      first,
      second,
    ]);

    assert.strictEqual(firstStagehand, secondStagehand);
    assert.equal(store.instances.length, 1);
    await store.destroy();
  });

  it("closes an initialization deleted while it is in flight", async () => {
    const store = new TestSessionStore();
    const init = deferred();
    store.nextInitGate = init.promise;
    await store.createSession("session", sessionParams);

    const initialization = store.getOrCreateStagehand("session", {});
    await waitFor(() => store.instances.length === 1);
    const deletion = store.deleteSession("session");
    await waitFor(() => store.size === 0);

    init.resolve();
    await assert.rejects(initialization, /Session not found/);
    await deletion;

    assert.equal(store.instances[0].closeCalls.length, 1);
    await store.destroy();
  });

  it("isolates overlapping request loggers and suppresses late logs", async () => {
    const store = new TestSessionStore();
    await store.createSession("session", sessionParams);
    await store.getOrCreateStagehand("session", {});
    const stagehand = store.instances[0];
    const firstLogs: string[] = [];
    const secondLogs: string[] = [];
    const releaseFirst = deferred();
    const releaseSecond = deferred();

    const first = store.runWithRequestContext(
      {
        logger: (line) => firstLogs.push(line.message),
      },
      async () => {
        await releaseFirst.promise;
        stagehand.emit(logLine("first"));
      },
    );
    const second = store.runWithRequestContext(
      {
        logger: (line) => secondLogs.push(line.message),
      },
      async () => {
        await releaseSecond.promise;
        stagehand.emit(logLine("second"));
      },
    );

    releaseSecond.resolve();
    await second;
    releaseFirst.resolve();
    await first;

    assert.deepEqual(firstLogs, ["first"]);
    assert.deepEqual(secondLogs, ["second"]);

    const releaseLateLog = deferred();
    let lateTask!: Promise<void>;
    await store.runWithRequestContext(
      {
        logger: (line) => firstLogs.push(line.message),
      },
      async () => {
        lateTask = (async () => {
          await releaseLateLog.promise;
          stagehand.emit(logLine("late"));
        })();
      },
    );

    releaseLateLog.resolve();
    await lateTask;
    assert.deepEqual(firstLogs, ["first"]);
    await store.destroy();
  });

  it("detaches all excess LRU entries before asynchronous shutdown finishes", async () => {
    const store = new TestSessionStore({ maxCapacity: 3 });
    for (const sessionId of ["one", "two", "three"]) {
      await store.createSession(sessionId, sessionParams);
      await store.getOrCreateStagehand(sessionId, {});
    }

    const firstClose = deferred();
    const secondClose = deferred();
    store.instances[0].closeGate = firstClose.promise;
    store.instances[1].closeGate = secondClose.promise;

    const update = store.updateCacheConfig({ maxCapacity: 1 });
    await waitFor(() => store.size === 1);

    assert.equal(store.size, 1);
    assert.equal(store.instances[0].closeCalls.length, 1);
    assert.equal(store.instances[1].closeCalls.length, 1);
    assert.equal(await store.hasSession("three"), true);

    firstClose.resolve();
    secondClose.resolve();
    await update;
    await store.destroy();
  });
});
