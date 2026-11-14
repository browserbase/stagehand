import { describe, expect, it, vi } from "vitest";
import {
  createBrowserbaseExtensionClient,
  provisionBrowserbaseExtension,
  shareBrowserbaseExtension,
  type BrowserbaseExtensionClient,
  type ProvisionedBrowserbaseExtension,
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

  it("waits as long as the 429 Retry-After header asks", async () => {
    const uploadExtension = vi
      .fn<() => Promise<{ id: string }>>()
      .mockRejectedValueOnce(
        Object.assign(new Error("429 Too Many Requests"), {
          status: 429,
          headers: { "retry-after": "43" },
        }),
      )
      .mockResolvedValueOnce({ id: "ext_after_window" });
    const sleeps: number[] = [];
    const client: BrowserbaseExtensionClient = { uploadExtension, async deleteExtension() {} };

    const provisioned = await provisionBrowserbaseExtension(client, import.meta.filename, {
      sleep: async (ms) => void sleeps.push(ms),
    });
    expect(provisioned.extensionId).toBe("ext_after_window");
    expect(sleeps).toStrictEqual([43_000]);
  });

  it("stops retrying once Retry-After would exceed the total wait cap", async () => {
    const rateLimited = (seconds: string) =>
      Object.assign(new Error("429 Too Many Requests"), {
        status: 429,
        headers: { "retry-after": seconds },
      });
    const uploadExtension = vi
      .fn<() => Promise<{ id: string }>>()
      .mockRejectedValueOnce(rateLimited("40"))
      .mockRejectedValueOnce(rateLimited("40"));
    const sleeps: number[] = [];

    await expect(
      provisionBrowserbaseExtension(
        { uploadExtension, deleteExtension: vi.fn() },
        import.meta.filename,
        { sleep: async (ms) => void sleeps.push(ms) },
      ),
    ).rejects.toThrow("after 2 attempt(s)");
    expect(sleeps).toStrictEqual([40_000]);
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

describe("Shared Browserbase extension provisioning", () => {
  const client: BrowserbaseExtensionClient = {
    uploadExtension: vi.fn(),
    deleteExtension: vi.fn(),
  };

  function fakeProvision(ids: string[]) {
    const cleanups: ReturnType<typeof vi.fn>[] = [];
    const provision = vi.fn(async (): Promise<ProvisionedBrowserbaseExtension> => {
      const cleanup = vi.fn(async () => {});
      cleanups.push(cleanup);
      return { extensionId: ids[cleanups.length - 1]!, cleanup };
    });
    return { provision, cleanups };
  }

  it("uploads once for concurrent launches and deletes after the last cleanup", async () => {
    const { provision, cleanups } = fakeProvision(["ext_shared"]);
    const share = shareBrowserbaseExtension("concurrent", provision);

    const launches = await Promise.all(Array.from({ length: 10 }, () => share(client)));
    expect(provision).toHaveBeenCalledOnce();
    expect(new Set(launches.map((launch) => launch.extensionId))).toStrictEqual(
      new Set(["ext_shared"]),
    );

    for (const launch of launches.slice(0, -1)) {
      await launch.cleanup();
      await launch.cleanup();
    }
    expect(cleanups[0]).not.toHaveBeenCalled();

    await launches.at(-1)!.cleanup();
    expect(cleanups[0]).toHaveBeenCalledOnce();
  });

  it("uploads again after every holder has cleaned up", async () => {
    const { provision } = fakeProvision(["ext_first", "ext_second"]);
    const share = shareBrowserbaseExtension("reupload", provision);

    const first = await share(client);
    await first.cleanup();
    const second = await share(client);

    expect(provision).toHaveBeenCalledTimes(2);
    expect(second.extensionId).toBe("ext_second");
  });

  it("does not share uploads across keys", async () => {
    const { provision } = fakeProvision(["ext_a", "ext_b"]);

    const a = await shareBrowserbaseExtension("project-a", provision)(client);
    const b = await shareBrowserbaseExtension("project-b", provision)(client);

    expect(provision).toHaveBeenCalledTimes(2);
    expect([a.extensionId, b.extensionId]).toStrictEqual(["ext_a", "ext_b"]);
  });

  it("rejects every waiting launch on a failed upload and retries on the next launch", async () => {
    const failure = new Error("upload failed");
    const provision = vi
      .fn<(client: BrowserbaseExtensionClient) => Promise<ProvisionedBrowserbaseExtension>>()
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce({ extensionId: "ext_retry", cleanup: vi.fn(async () => {}) });
    const share = shareBrowserbaseExtension("failed", provision);

    const results = await Promise.allSettled([share(client), share(client)]);
    expect(results.map((result) => result.status)).toStrictEqual(["rejected", "rejected"]);
    expect(provision).toHaveBeenCalledOnce();

    await expect(share(client)).resolves.toMatchObject({ extensionId: "ext_retry" });
    expect(provision).toHaveBeenCalledTimes(2);
  });

  it("retries the delete when the last cleanup fails", async () => {
    const cleanup = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("delete failed"))
      .mockResolvedValueOnce();
    const share = shareBrowserbaseExtension(
      "delete-retry",
      vi.fn(async () => ({ extensionId: "ext_delete", cleanup })),
    );

    const launch = await share(client);
    await expect(launch.cleanup()).rejects.toThrow("delete failed");
    await launch.cleanup();
    expect(cleanup).toHaveBeenCalledTimes(2);
  });
});
