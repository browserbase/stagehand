import { test, expect } from "@playwright/test";
import WebSocket from "ws";
import { V3 } from "../../lib/v3/v3.js";
import { v3TestConfig } from "./v3.config.js";
import { raceTimeout } from "./testUtils.js";

test.describe("CdpConnection.close() after external WebSocket close", () => {
  let v3: V3;

  test.beforeEach(async () => {
    v3 = new V3(v3TestConfig);
    await v3.init();
  });

  test.afterEach(async () => {
    // Best-effort teardown – don't let a hung close block the suite.
    try {
      await raceTimeout(v3?.close?.(), 5_000);
    } catch {
      // ignore
    }
  });

  test("v3.close() resolves after the CDP WebSocket is already closed", async () => {
    // Verify the V3 instance is functional.
    const page = v3.context.pages()[0];
    await page.goto("data:text/html,<html><body>close-test</body></html>");

    const conn = v3.context.conn;

    // Unhook the V3-level _onCdpClosed handler so it doesn't trigger
    // _immediateShutdown in the background (we want to isolate the
    // CdpConnection.close() hang).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const onCdpClosed = (v3 as any)._onCdpClosed;
    if (onCdpClosed) {
      conn.offTransportClosed(onCdpClosed);
    }

    // Wait for the transport-close event to be fully processed.
    const transportClosed = new Promise<void>((resolve) => {
      conn.onTransportClosed(() => resolve());
    });

    // Terminate the underlying WebSocket – simulates the hosted API
    // killing the Browserbase session, which closes the CDP socket
    // from the server side.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ws: WebSocket = (conn as any).ws;
    ws.terminate();

    await transportClosed;

    // Now call v3.close(). Internally this calls ctx.close() →
    // conn.close(), which awaits a "close" event on an already-CLOSED
    // WebSocket. Without the fix this promise never resolves.
    const result = await raceTimeout(
      v3.close().then(() => "resolved" as const),
      5_000,
    );

    expect(result).toBe("resolved");
  });

  test("inflight CDP calls reject when the WebSocket is terminated", async () => {
    const page = v3.context.pages()[0];
    await page.goto("data:text/html,<html><body>inflight-test</body></html>");

    const conn = v3.context.conn;

    // Unhook the V3-level handler as above.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const onCdpClosed = (v3 as any)._onCdpClosed;
    if (onCdpClosed) {
      conn.offTransportClosed(onCdpClosed);
    }

    // Send a long-running CDP call that the server will never answer.
    const pending = conn.send("Runtime.evaluate", {
      expression: "new Promise(r => setTimeout(() => r('done'), 60000))",
      awaitPromise: true,
    });

    // Terminate the WebSocket while the call is inflight.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ws: WebSocket = (conn as any).ws;
    ws.terminate();

    // The pending promise must reject – not hang forever.
    const result = await raceTimeout(
      pending.then(() => "resolved" as const).catch(() => "rejected" as const),
      5_000,
    );

    expect(result).toBe("rejected");
  });
});
