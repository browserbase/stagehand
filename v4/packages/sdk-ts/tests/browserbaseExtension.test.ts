import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vite-plus/test";
import { strFromU8, unzipSync } from "fflate";
import {
  createBrowserbaseExtensionArchive,
  createBrowserbaseExtensionClient,
  provisionBrowserbaseExtension,
  type BrowserbaseExtensionClient,
} from "../src/browserbaseExtension.js";

describe("Browserbase extension packaging", () => {
  it("places the manifest and built assets at the archive root", async () => {
    const extensionDir = await createExtensionFixture();
    const archive = await createBrowserbaseExtensionArchive(extensionDir);

    try {
      const files = unzipSync(await readFile(archive.path));
      expect(Object.keys(files).toSorted()).toStrictEqual([
        "manifest.json",
        "offscreen/heartbeat.html",
        "service-worker.js",
      ]);
      expect(strFromU8(files["manifest.json"]!)).toBe('{"manifest_version":3}');
      expect(strFromU8(files["offscreen/heartbeat.html"]!)).toBe("heartbeat");
    } finally {
      await archive.cleanup();
      await rm(extensionDir, { force: true, recursive: true });
    }

    expect(existsSync(archive.path)).toBe(false);
    await expect(archive.cleanup()).resolves.toBeUndefined();
  });

  it("rejects an extension directory without a root manifest", async () => {
    const extensionDir = await mkdtemp(path.join(tmpdir(), "stagehand-extension-fixture-"));
    try {
      await writeFile(path.join(extensionDir, "service-worker.js"), "worker", "utf8");
      await expect(createBrowserbaseExtensionArchive(extensionDir)).rejects.toThrow(
        "extension manifest was not found",
      );
    } finally {
      await rm(extensionDir, { force: true, recursive: true });
    }
  });
});

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
  it("uploads the archive, removes the local copy, and owns remote cleanup", async () => {
    const extensionDir = await createExtensionFixture();
    let uploadedArchivePath: string | undefined;
    const uploadExtension = vi.fn(async (archivePath: string) => {
      uploadedArchivePath = archivePath;
      expect(existsSync(archivePath)).toBe(true);
      expect(Object.keys(unzipSync(await readFile(archivePath)))).toContain("manifest.json");
      return { id: " ext_uploaded " };
    });
    const deleteExtension = vi.fn(async () => {});
    const client: BrowserbaseExtensionClient = { uploadExtension, deleteExtension };

    try {
      const provisioned = await provisionBrowserbaseExtension(client, extensionDir);
      expect(provisioned.extensionId).toBe("ext_uploaded");
      expect(uploadedArchivePath).toBeDefined();
      expect(existsSync(uploadedArchivePath!)).toBe(false);

      await provisioned.cleanup();
      await provisioned.cleanup();
      expect(deleteExtension).toHaveBeenCalledOnce();
      expect(deleteExtension).toHaveBeenCalledWith("ext_uploaded");
    } finally {
      await rm(extensionDir, { force: true, recursive: true });
    }
  });

  it("removes the local archive and preserves an upload failure as the cause", async () => {
    const extensionDir = await createExtensionFixture();
    let uploadedArchivePath: string | undefined;
    const uploadError = new Error("Browserbase unavailable");
    const client: BrowserbaseExtensionClient = {
      async uploadExtension(archivePath) {
        uploadedArchivePath = archivePath;
        throw uploadError;
      },
      async deleteExtension() {},
    };

    try {
      const error = await provisionBrowserbaseExtension(client, extensionDir).catch(
        (caught: unknown) => caught,
      );
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe(
        "Failed to upload the Stagehand extension to Browserbase",
      );
      expect((error as Error).cause).toBe(uploadError);
      expect(uploadedArchivePath).toBeDefined();
      expect(existsSync(uploadedArchivePath!)).toBe(false);
    } finally {
      await rm(extensionDir, { force: true, recursive: true });
    }
  });

  it("rejects an empty extension ID", async () => {
    const extensionDir = await createExtensionFixture();
    const client: BrowserbaseExtensionClient = {
      async uploadExtension() {
        return { id: " " };
      },
      async deleteExtension() {},
    };

    try {
      await expect(provisionBrowserbaseExtension(client, extensionDir)).rejects.toThrow(
        "empty extension ID",
      );
    } finally {
      await rm(extensionDir, { force: true, recursive: true });
    }
  });
});

async function createExtensionFixture(): Promise<string> {
  const extensionDir = await mkdtemp(path.join(tmpdir(), "stagehand-extension-fixture-"));
  await mkdir(path.join(extensionDir, "offscreen"));
  await writeFile(path.join(extensionDir, "manifest.json"), '{"manifest_version":3}', "utf8");
  await writeFile(path.join(extensionDir, "service-worker.js"), "worker", "utf8");
  await writeFile(path.join(extensionDir, "offscreen/heartbeat.html"), "heartbeat", "utf8");
  return extensionDir;
}
