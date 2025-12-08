import { test, expect } from "@playwright/test";
import { V3 } from "../v3";
import { v3TestConfig } from "./v3.config";

test.describe("Page Network Events", () => {
  let v3: V3;

  test.beforeEach(async () => {
    v3 = new V3(v3TestConfig);
    await v3.init();
  });

  test.afterEach(async () => {
    await v3?.close?.().catch(() => {});
  });

  test("should capture network request events", async () => {
    const page = v3.context.pages()[0];
    const requests: any[] = [];

    page.on("network", (message) => {
      if (message.type() === "request") {
        requests.push(message);
      }
    });

    await page.goto("https://example.com");

    expect(requests.length).toBeGreaterThan(0);
    const mainRequest = requests.find((r) => r.url().includes("example.com"));
    expect(mainRequest).toBeDefined();
    expect(mainRequest?.method()).toBe("GET");
  });

  test("should capture network response events", async () => {
    const page = v3.context.pages()[0];
    const responses: any[] = [];

    page.on("network", (message) => {
      if (message.type() === "response") {
        responses.push(message);
      }
    });

    await page.goto("https://example.com");

    expect(responses.length).toBeGreaterThan(0);
    const mainResponse = responses.find((r) => r.url().includes("example.com"));
    expect(mainResponse).toBeDefined();
    expect(mainResponse?.status()).toBe(200);
    expect(mainResponse?.statusText()).toBeDefined();
  });

  test("should provide resource type information", async () => {
    const page = v3.context.pages()[0];
    const messages: any[] = [];

    page.on("network", (message) => {
      messages.push(message);
    });

    await page.goto("https://example.com");

    const documentRequest = messages.find(
      (m) => m.resourceType() === "Document",
    );
    expect(documentRequest).toBeDefined();
  });

  test("should support once() for single event", async () => {
    const page = v3.context.pages()[0];
    let callCount = 0;

    page.once("network", (message) => {
      callCount++;
      expect(message).toBeDefined();
    });

    await page.goto("https://example.com");

    // Even though multiple network events occur, once() should only fire once
    expect(callCount).toBe(1);
  });

  test("should support removing listeners with off()", async () => {
    const page = v3.context.pages()[0];
    let callCount = 0;

    const listener = (message: any) => {
      callCount++;
    };

    page.on("network", listener);
    await page.goto("https://example.com");

    const firstCallCount = callCount;
    expect(firstCallCount).toBeGreaterThan(0);

    page.off("network", listener);
    callCount = 0;

    await page.goto("https://example.com");
    expect(callCount).toBe(0);
  });

  test("should provide request headers", async () => {
    const page = v3.context.pages()[0];
    let foundHeaders = false;

    page.on("network", (message) => {
      if (message.type() === "request") {
        const headers = message.requestHeaders();
        if (headers && Object.keys(headers).length > 0) {
          foundHeaders = true;
        }
      }
    });

    await page.goto("https://example.com");
    expect(foundHeaders).toBe(true);
  });

  test("should provide response headers", async () => {
    const page = v3.context.pages()[0];
    let foundHeaders = false;

    page.on("network", (message) => {
      if (message.type() === "response") {
        const headers = message.responseHeaders();
        if (headers && Object.keys(headers).length > 0) {
          foundHeaders = true;
        }
      }
    });

    await page.goto("https://example.com");
    expect(foundHeaders).toBe(true);
  });

  test("should provide MIME type for responses", async () => {
    const page = v3.context.pages()[0];
    let foundMimeType = false;

    page.on("network", (message) => {
      if (message.type() === "response") {
        const mimeType = message.mimeType();
        if (mimeType && mimeType.includes("text/html")) {
          foundMimeType = true;
        }
      }
    });

    await page.goto("https://example.com");
    expect(foundMimeType).toBe(true);
  });

  test("should track frame and loader IDs", async () => {
    const page = v3.context.pages()[0];
    let hasFrameId = false;
    let hasLoaderId = false;

    page.on("network", (message) => {
      if (message.frameId()) hasFrameId = true;
      if (message.loaderId()) hasLoaderId = true;
    });

    await page.goto("https://example.com");
    expect(hasFrameId).toBe(true);
    expect(hasLoaderId).toBe(true);
  });

  test("should provide unique request IDs", async () => {
    const page = v3.context.pages()[0];
    const requestIds = new Set<string>();

    page.on("network", (message) => {
      requestIds.add(message.requestId());
    });

    await page.goto("https://example.com");
    expect(requestIds.size).toBeGreaterThan(0);
  });

  test("should support toString() method", async () => {
    const page = v3.context.pages()[0];
    let foundToString = false;

    page.on("network", (message) => {
      const str = message.toString();
      expect(typeof str).toBe("string");
      expect(str.length).toBeGreaterThan(0);
      if (str.includes("Request") || str.includes("Response")) {
        foundToString = true;
      }
    });

    await page.goto("https://example.com");
    expect(foundToString).toBe(true);
  });

  test("should provide page reference", async () => {
    const page = v3.context.pages()[0];
    let hasPageRef = false;

    page.on("network", (message) => {
      const messagePage = message.page();
      if (messagePage === page) {
        hasPageRef = true;
      }
    });

    await page.goto("https://example.com");
    expect(hasPageRef).toBe(true);
  });

  test("should capture both requests and responses for same URL", async () => {
    const page = v3.context.pages()[0];
    const events: { type: string; url: string }[] = [];

    page.on("network", (message) => {
      events.push({
        type: message.type(),
        url: message.url(),
      });
    });

    await page.goto("https://example.com");

    const exampleEvents = events.filter((e) => e.url.includes("example.com"));
    const hasRequest = exampleEvents.some((e) => e.type === "request");
    const hasResponse = exampleEvents.some((e) => e.type === "response");

    expect(hasRequest).toBe(true);
    expect(hasResponse).toBe(true);
  });

  test("should work across multiple pages", async () => {
    const page1 = v3.context.pages()[0];
    const page2 = await v3.context.newPage();

    const page1Events: string[] = [];
    const page2Events: string[] = [];

    page1.on("network", (message) => {
      page1Events.push(message.url());
    });

    page2.on("network", (message) => {
      page2Events.push(message.url());
    });

    await page1.goto("https://example.com");
    await page2.goto("https://httpbin.org/html");

    expect(page1Events.some((url) => url.includes("example.com"))).toBe(true);
    expect(page1Events.some((url) => url.includes("httpbin.org"))).toBe(false);

    expect(page2Events.some((url) => url.includes("httpbin.org"))).toBe(true);
    expect(page2Events.some((url) => url.includes("example.com"))).toBe(false);

    await page2.close();
  });

  test("should support multiple simultaneous listeners", async () => {
    const page = v3.context.pages()[0];
    let listener1Called = false;
    let listener2Called = false;
    let listener3Called = false;

    page.on("network", () => {
      listener1Called = true;
    });

    page.on("network", () => {
      listener2Called = true;
    });

    page.on("network", () => {
      listener3Called = true;
    });

    await page.goto("https://example.com");

    expect(listener1Called).toBe(true);
    expect(listener2Called).toBe(true);
    expect(listener3Called).toBe(true);
  });

  test("should handle errors in listeners gracefully", async () => {
    const page = v3.context.pages()[0];
    let goodListenerCalled = false;

    page.on("network", () => {
      throw new Error("Listener error");
    });

    page.on("network", () => {
      goodListenerCalled = true;
    });

    await page.goto("https://example.com");

    // The second listener should still be called even if first throws
    expect(goodListenerCalled).toBe(true);
  });

  test("should filter by resource type", async () => {
    const page = v3.context.pages()[0];
    const documentRequests: any[] = [];
    const imageRequests: any[] = [];

    page.on("network", (message) => {
      if (message.resourceType() === "Document") {
        documentRequests.push(message);
      } else if (message.resourceType() === "Image") {
        imageRequests.push(message);
      }
    });

    await page.goto("https://example.com");

    expect(documentRequests.length).toBeGreaterThan(0);
  });

  test("should provide POST data for POST requests", async () => {
    const page = v3.context.pages()[0];
    let foundPostData = false;

    page.on("network", (message) => {
      if (message.type() === "request" && message.method() === "POST") {
        const postData = message.postData();
        if (postData) {
          foundPostData = true;
        }
      }
    });

    await page.goto("https://httpbin.org/forms/post");
    await page.evaluate(() => {
      const form = document.querySelector("form");
      if (form) {
        const input = form.querySelector(
          'input[name="custname"]',
        ) as HTMLInputElement;
        if (input) input.value = "test";
        form.submit();
      }
    });

    await page.waitForLoadState("load").catch(() => {});

    // POST data may or may not be captured depending on timing and form behavior
    // Soft expectation - POST data capture is timing-dependent
    expect.soft(foundPostData).toBe(true);
  });
});
