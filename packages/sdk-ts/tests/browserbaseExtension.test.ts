import { describe, expect, it, vi } from "vitest";
import {
  createBrowserbaseExtensionClient,
  provisionBrowserbaseExtension,
  type BrowserbaseExtensionClient,
} from "../src/browserbaseExtension.js";

describe("Browserbase extension client", () => {
  it.each([0, -1, 1.5, 5, NaN, Infinity])(
    "rejects an unbounded upload attempt count %s",
    async (attempts) => {
      const uploadExtension = vi.fn();
      await expect(
        provisionBrowserbaseExtension(
          { uploadExtension, deleteExtension: vi.fn() },
          "/archive.zip",
          { attempts },
        ),
      ).rejects.toThrow("attempts must be");
      expect(uploadExtension).not.toHaveBeenCalled();
    },
  );

  it("does not print credential-bearing upload errors in the public startup message", async () => {
    const secretError = new Error("https://example.test?apiKey=private-key");
    const error = await provisionBrowserbaseExtension(
      { uploadExtension: vi.fn().mockRejectedValue(secretError), deleteExtension: vi.fn() },
      "/archive.zip",
      { attempts: 1 },
    ).catch((error: Error) => error);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toContain("private-key");
    expect((error as Error).cause).toBe(secretError);
  });

  it("maps extension upload and deletion to the official SDK surface", async () => {
    const create = vi.fn(async () => ({ id: "ext_uploaded" }));
    const remove = vi.fn(async () => {});
    const createSdk = vi.fn(() => ({
      extensions: { create, delete: remove },
    }));
    const client = createBrowserbaseExtensionClient("bb_key", createSdk);

    await expect(client.uploadExtension(import.meta.filename)).resolves.toStrictEqual({
      id: "ext_uploaded",
    });
    await client.deleteExtension("ext_uploaded");

    expect(createSdk).toHaveBeenCalledWith("bb_key");
    expect(create).toHaveBeenCalledWith({ file: expect.anything() }, { maxRetries: 0 });
    expect(remove).toHaveBeenCalledWith("ext_uploaded", {
      headers: { "Content-Type": null },
    });
  });
});

describe("Browserbase extension provisioning", () => {
  it("uploads the prebuilt archive and owns remote cleanup", async () => {
    const archivePath = import.meta.filename;
    const uploadExtension = vi.fn(async () => ({ id: " ext_uploaded " }));
    const deleteExtension = vi.fn(async () => {});
    const client: BrowserbaseExtensionClient = { uploadExtension, deleteExtension };

    const provisioned = await provisionBrowserbaseExtension(client, archivePath);
    expect(provisioned.extensionId).toBe("ext_uploaded");
    expect(uploadExtension).toHaveBeenCalledWith(archivePath);

    await provisioned.cleanup();
    await provisioned.cleanup();
    expect(deleteExtension).toHaveBeenCalledOnce();
    expect(deleteExtension).toHaveBeenCalledWith("ext_uploaded");
  });

  it("preserves an upload failure as the cause and names it in the message", async () => {
    const uploadError = Object.assign(new Error("Rate limited"), { status: 429 });
    const uploadExtension = vi.fn(async () => {
      throw uploadError;
    });
    const client: BrowserbaseExtensionClient = { uploadExtension, async deleteExtension() {} };

    const error = await provisionBrowserbaseExtension(client, import.meta.filename, {
      sleep: async () => {},
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(
      "Failed to upload the Stagehand extension to Browserbase after 4 attempt(s).",
    );
    expect((error as Error).cause).toBe(uploadError);
    expect(uploadExtension).toHaveBeenCalledTimes(4);
  });

  it("retries a burst-rejected upload with backoff before giving up", async () => {
    const uploadExtension = vi
      .fn<() => Promise<{ id: string }>>()
      .mockRejectedValueOnce(Object.assign(new Error("429 Too Many Requests"), { status: 429 }))
      .mockRejectedValueOnce(Object.assign(new Error("429 Too Many Requests"), { status: 429 }))
      .mockResolvedValueOnce({ id: "ext_after_retry" });
    const sleeps: number[] = [];
    const client: BrowserbaseExtensionClient = { uploadExtension, async deleteExtension() {} };

    const provisioned = await provisionBrowserbaseExtension(client, import.meta.filename, {
      sleep: async (ms) => void sleeps.push(ms),
    });
    expect(provisioned.extensionId).toBe("ext_after_retry");
    expect(uploadExtension).toHaveBeenCalledTimes(3);
    expect(sleeps).toStrictEqual([500, 1500]);
  });

  it.each([401, 403, 500, 503, undefined])(
    "does not replay ambiguous or permanent upload failures (%s)",
    async (status) => {
      const failure = Object.assign(new Error("upload failed"), { status });
      const uploadExtension = vi.fn().mockRejectedValue(failure);
      const sleep = vi.fn();
      await expect(
        provisionBrowserbaseExtension(
          { uploadExtension, deleteExtension: vi.fn() },
          "/archive.zip",
          { sleep },
        ),
      ).rejects.toMatchObject({
        message: "Failed to upload the Stagehand extension to Browserbase after 1 attempt(s).",
        cause: failure,
      });
      expect(uploadExtension).toHaveBeenCalledOnce();
      expect(sleep).not.toHaveBeenCalled();
    },
  );

  it("rejects an empty extension ID", async () => {
    const client: BrowserbaseExtensionClient = {
      async uploadExtension() {
        return { id: " " };
      },
      async deleteExtension() {},
    };

    await expect(provisionBrowserbaseExtension(client, import.meta.filename)).rejects.toThrow(
      "empty extension ID",
    );
  });
});
