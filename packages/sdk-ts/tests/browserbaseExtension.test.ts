import { describe, expect, it, vi } from "vitest";
import {
  loadStagehandExtensionArchive,
  provisionBrowserbaseExtension,
  type BrowserbaseExtensionClient,
} from "../src/browserbaseExtension.js";

describe("Browserbase extension archive", () => {
  it("loads the prebuilt extension archive into a web-standard Blob", async () => {
    const archive = await loadStagehandExtensionArchive(import.meta.filename);

    expect(archive.size).toBeGreaterThan(0);
    expect(archive.type).toBe("application/zip");
  });
});

describe("Browserbase extension provisioning", () => {
  it("uploads the prebuilt archive and owns remote cleanup", async () => {
    const archivePath = import.meta.filename;
    const uploadExtension = vi.fn(async (archive: Blob) => {
      expect(await archive.text()).toContain("Browserbase extension provisioning");
      return { id: " ext_uploaded " };
    });
    const deleteExtension = vi.fn(async () => {});
    const client: BrowserbaseExtensionClient = { uploadExtension, deleteExtension };

    const provisioned = await provisionBrowserbaseExtension(client, archivePath);
    expect(provisioned.extensionId).toBe("ext_uploaded");
    expect(uploadExtension).toHaveBeenCalledOnce();

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
