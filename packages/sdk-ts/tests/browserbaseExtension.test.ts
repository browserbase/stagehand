import { describe, expect, it, vi } from "vite-plus/test";
import {
  createBrowserbaseExtensionClient,
  provisionBrowserbaseExtension,
  type BrowserbaseExtensionClient,
} from "../src/browserbaseExtension.js";

describe("Browserbase extension client", () => {
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
    expect(create).toHaveBeenCalledWith({ file: expect.anything() });
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

  it("preserves an upload failure as the cause", async () => {
    const uploadError = new Error("Browserbase unavailable");
    const client: BrowserbaseExtensionClient = {
      async uploadExtension() {
        throw uploadError;
      },
      async deleteExtension() {},
    };

    const error = await provisionBrowserbaseExtension(client, import.meta.filename).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(
      "Failed to upload the Stagehand extension to Browserbase",
    );
    expect((error as Error).cause).toBe(uploadError);
  });

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
