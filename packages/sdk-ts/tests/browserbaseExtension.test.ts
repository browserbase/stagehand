import { describe, expect, it, vi } from "vitest";
import { strFromU8, unzipSync, zipSync } from "fflate";
import {
  loadStagehandExtensionArchive,
  provisionBrowserbaseExtension,
  type BrowserbaseExtensionClient,
} from "../src/browserbaseExtension.js";

describe("Browserbase extension archive", () => {
  it("loads the bundled extension without exposing filesystem APIs", async () => {
    const archive = await loadStagehandExtensionArchive();
    const files = unzipSync(new Uint8Array(await archive.arrayBuffer()));

    expect(Object.keys(files)).toContain("manifest.json");
    expect(JSON.parse(strFromU8(files["manifest.json"]!))).toMatchObject({
      manifest_version: 3,
    });
    expect(archive.type).toBe("application/zip");
  });

  it("loads an extension archive over fetch in web runtimes", async () => {
    const archiveBytes = zipSync({
      "manifest.json": new TextEncoder().encode('{"manifest_version":3}'),
    });
    const fetchArchive = vi.fn(async () => new Response(archiveBytes));

    const archive = await loadStagehandExtensionArchive(
      new URL("https://assets.example.test/stagehand-extension.zip"),
      { fetch: fetchArchive },
    );

    expect(fetchArchive).toHaveBeenCalledWith(
      new URL("https://assets.example.test/stagehand-extension.zip"),
    );
    expect(new Uint8Array(await archive.arrayBuffer())).toStrictEqual(archiveBytes);
  });

  it("rejects failed and empty archive responses", async () => {
    await expect(
      loadStagehandExtensionArchive(new URL("https://assets.example.test/missing.zip"), {
        fetch: async () => new Response(null, { status: 404, statusText: "Not Found" }),
      }),
    ).rejects.toThrow("404 Not Found");

    await expect(
      loadStagehandExtensionArchive(new URL("https://assets.example.test/empty.zip"), {
        fetch: async () => new Response(new Uint8Array()),
      }),
    ).rejects.toThrow("archive is empty");
  });
});

describe("Browserbase extension provisioning", () => {
  it("uploads in-memory bytes and owns remote cleanup", async () => {
    const archive = new Blob(["zip"], { type: "application/zip" });
    const uploadExtension = vi.fn(async (uploadedArchive: Blob) => {
      expect(uploadedArchive).toBe(archive);
      return { id: " ext_uploaded " };
    });
    const deleteExtension = vi.fn(async () => {});
    const client: BrowserbaseExtensionClient = { uploadExtension, deleteExtension };

    const provisioned = await provisionBrowserbaseExtension(client, async () => archive);
    expect(provisioned.extensionId).toBe("ext_uploaded");

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

    const error = await provisionBrowserbaseExtension(client, async () => new Blob(["zip"])).catch(
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

    await expect(
      provisionBrowserbaseExtension(client, async () => new Blob(["zip"])),
    ).rejects.toThrow("empty extension ID");
  });
});
