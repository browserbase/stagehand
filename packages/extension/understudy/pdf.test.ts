import { trace } from "@opentelemetry/api";
import { describe, expect, it, vi } from "vitest";
import { StagehandLogger } from "../logger.js";
import { CdpConnection, type CDPSessionLike } from "./cdp.js";
import { Page } from "./page.js";

describe("Page.pdf", () => {
  it("renders through Page.printToPDF and decodes the returned bytes", async () => {
    const logger = new StagehandLogger({ tracer: trace.getTracer("pdf-test") }, () => {});
    const connection = new CdpConnection(
      {
        connected: true,
        send: vi.fn(),
        close: vi.fn(async () => {}),
        onMessage: vi.fn(),
        onClose: vi.fn(),
        onError: vi.fn(),
      },
      logger,
    );
    const send = vi.fn(async (_method: string, _params?: object): Promise<unknown> => ({}));
    const session: CDPSessionLike = {
      send: send as CDPSessionLike["send"],
      on: vi.fn(),
      off: vi.fn(),
      close: vi.fn(async () => {}),
      id: "session-1",
    };
    const page = new Page(connection, session, "page-1", "frame-1", logger);
    send.mockClear();
    send.mockResolvedValue({ data: "JVBERi0xLjcK" });

    await expect(
      page.pdf({
        landscape: true,
        printBackground: true,
        paperWidth: 8.5,
        paperHeight: 11,
        marginTop: 0.25,
      }),
    ).resolves.toStrictEqual(new TextEncoder().encode("%PDF-1.7\n"));
    expect(send).toHaveBeenCalledWith("Page.printToPDF", {
      landscape: true,
      printBackground: true,
      paperWidth: 8.5,
      paperHeight: 11,
      marginTop: 0.25,
      transferMode: "ReturnAsBase64",
    });

    page.dispose();
  });
});
