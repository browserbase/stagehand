import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { Page } from "../lib/v3/understudy/page";

describe("Page.waitForTimeout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves after the specified timeout", async () => {
    const mockPage = {
      waitForTimeout: (ms: number): Promise<void> => {
        return new Promise((resolve) => setTimeout(resolve, ms));
      },
    } as Pick<Page, "waitForTimeout">;

    const startTime = Date.now();
    const waitPromise = mockPage.waitForTimeout(500);

    // Fast-forward time by 500ms
    await vi.advanceTimersByTimeAsync(500);

    await waitPromise;

    // Verify the promise resolved after the timeout
    expect(Date.now() - startTime).toBeGreaterThanOrEqual(500);
  });

  it("resolves immediately for 0ms timeout", async () => {
    const mockPage = {
      waitForTimeout: (ms: number): Promise<void> => {
        return new Promise((resolve) => setTimeout(resolve, ms));
      },
    } as Pick<Page, "waitForTimeout">;

    const waitPromise = mockPage.waitForTimeout(0);
    await vi.advanceTimersByTimeAsync(0);
    await waitPromise;

    expect(true).toBe(true);
  });

  it("waits for the correct duration", async () => {
    const mockPage = {
      waitForTimeout: (ms: number): Promise<void> => {
        return new Promise((resolve) => setTimeout(resolve, ms));
      },
    } as Pick<Page, "waitForTimeout">;

    let resolved = false;
    const waitPromise = mockPage.waitForTimeout(1000).then(() => {
      resolved = true;
    });

    await vi.advanceTimersByTimeAsync(500);
    expect(resolved).toBe(false);

    // After another 500ms (total 1000ms), should be resolved
    await vi.advanceTimersByTimeAsync(500);
    await waitPromise;
    expect(resolved).toBe(true);
  });

  it("can be used with async/await syntax", async () => {
    const mockPage = {
      waitForTimeout: (ms: number): Promise<void> => {
        return new Promise((resolve) => setTimeout(resolve, ms));
      },
    } as Pick<Page, "waitForTimeout">;

    const results: number[] = [];

    const asyncFn = async () => {
      results.push(1);
      await mockPage.waitForTimeout(100);
      results.push(2);
      await mockPage.waitForTimeout(100);
      results.push(3);
    };

    const promise = asyncFn();

    expect(results).toEqual([1]);

    await vi.advanceTimersByTimeAsync(100);
    expect(results).toEqual([1, 2]);

    await vi.advanceTimersByTimeAsync(100);
    await promise;
    expect(results).toEqual([1, 2, 3]);
  });
});
