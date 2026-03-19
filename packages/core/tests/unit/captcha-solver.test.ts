import { describe, expect, it } from "vitest";
import { CaptchaSolver } from "../../lib/v3/agent/utils/captchaSolver.js";

const SOLVING_STARTED = "browserbase-solving-started";
const SOLVING_FINISHED = "browserbase-solving-finished";
const SOLVING_ERRORED = "browserbase-solving-errored";

type ConsoleListener = (message: { text: () => string }) => void;

class MockPage {
  private listeners = new Set<ConsoleListener>();
  public onCalls = 0;
  public offCalls = 0;

  on(event: string, listener: ConsoleListener): void {
    if (event !== "console") return;
    this.onCalls++;
    this.listeners.add(listener);
  }

  off(event: string, listener: ConsoleListener): void {
    if (event !== "console") return;
    this.offCalls++;
    this.listeners.delete(listener);
  }

  emitConsole(text: string): void {
    const message = { text: () => text };
    for (const listener of this.listeners) {
      listener(message);
    }
  }

  listenerCount(): number {
    return this.listeners.size;
  }
}

describe("CaptchaSolver", () => {
  it("resolves all concurrent waiters when a solve finishes", async () => {
    const page = new MockPage();
    const solver = new CaptchaSolver();
    solver.init(async () => page as never);

    await solver.ensureAttached();
    page.emitConsole(SOLVING_STARTED);

    const firstWait = solver.waitIfSolving();
    const secondWait = solver.waitIfSolving();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const sharedWaitPromise = (
      solver as unknown as { waitPromise: Promise<void> | null }
    ).waitPromise;

    expect(sharedWaitPromise).not.toBeNull();
    expect(
      (solver as unknown as { waitPromise: Promise<void> | null }).waitPromise,
    ).toBe(sharedWaitPromise);

    let firstResolved = false;
    let secondResolved = false;
    void firstWait.then(() => {
      firstResolved = true;
    });
    void secondWait.then(() => {
      secondResolved = true;
    });

    await Promise.resolve();
    expect(firstResolved).toBe(false);
    expect(secondResolved).toBe(false);

    page.emitConsole(SOLVING_FINISHED);
    await Promise.all([firstWait, secondWait]);

    expect(firstResolved).toBe(true);
    expect(secondResolved).toBe(true);
    expect(solver.consumeSolveResult()).toEqual({
      solved: true,
      errored: false,
    });
    expect(solver.consumeSolveResult()).toEqual({
      solved: false,
      errored: false,
    });
  });

  it("re-attaches to a new page and settles stale waiters when the active page changes", async () => {
    const firstPage = new MockPage();
    const secondPage = new MockPage();
    let activePage = firstPage;

    const solver = new CaptchaSolver();
    solver.init(async () => activePage as never);

    await solver.ensureAttached();
    firstPage.emitConsole(SOLVING_STARTED);

    const pendingWait = solver.waitIfSolving();
    let settled = false;
    void pendingWait.then(() => {
      settled = true;
    });

    activePage = secondPage;
    await solver.waitIfSolving();
    await pendingWait;

    expect(settled).toBe(true);
    expect(firstPage.offCalls).toBe(1);
    expect(firstPage.listenerCount()).toBe(0);
    expect(secondPage.onCalls).toBe(1);
    expect(secondPage.listenerCount()).toBe(1);
    expect(solver.isSolving()).toBe(false);
  });

  it("surfaces solver errors exactly once per consume", async () => {
    const page = new MockPage();
    const solver = new CaptchaSolver();
    solver.init(async () => page as never);

    await solver.ensureAttached();
    page.emitConsole(SOLVING_STARTED);

    const wait = solver.waitIfSolving();
    page.emitConsole(SOLVING_ERRORED);
    await wait;

    expect(solver.consumeSolveResult()).toEqual({
      solved: false,
      errored: true,
    });
    expect(solver.consumeSolveResult()).toEqual({
      solved: false,
      errored: false,
    });
  });

  it("disposes cleanly while a solve is in progress", async () => {
    const page = new MockPage();
    const solver = new CaptchaSolver();
    solver.init(async () => page as never);

    await solver.ensureAttached();
    page.emitConsole(SOLVING_STARTED);

    const wait = solver.waitIfSolving();
    await new Promise((resolve) => setTimeout(resolve, 0));
    let settled = false;
    void wait.then(() => {
      settled = true;
    });

    solver.dispose();
    await wait;

    expect(settled).toBe(true);
    expect(solver.isSolving()).toBe(false);
    expect(page.listenerCount()).toBe(0);
    expect(solver.consumeSolveResult()).toEqual({
      solved: false,
      errored: false,
    });
  });

  it("marks errored when detached mid-solve due to page change", async () => {
    const firstPage = new MockPage();
    const secondPage = new MockPage();
    let activePage = firstPage;

    const solver = new CaptchaSolver();
    solver.init(async () => activePage as never);

    await solver.ensureAttached();
    firstPage.emitConsole(SOLVING_STARTED);

    const wait = solver.waitIfSolving();

    // Switch to a new page while the solve is in progress
    activePage = secondPage;
    await solver.waitIfSolving();
    await wait;

    // The interrupted solve should be reported as errored
    expect(solver.consumeSolveResult()).toEqual({
      solved: false,
      errored: true,
    });
  });
});
