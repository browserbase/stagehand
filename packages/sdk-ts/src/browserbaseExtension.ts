import { createReadStream } from "node:fs";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import Browserbase from "@browserbasehq/sdk";
import { zip } from "fflate";

const DEFAULT_EXTENSION_DIR = new URL("../../server/dist", import.meta.url).pathname;

export type BrowserbaseExtensionArchive = {
  path: string;
  cleanup(): Promise<void>;
};

export type BrowserbaseExtensionClient = {
  uploadExtension(archivePath: string): Promise<{ id: string }>;
  deleteExtension(extensionId: string): Promise<void>;
};

export type ProvisionedBrowserbaseExtension = {
  extensionId: string;
  cleanup(): Promise<void>;
};

export type BrowserbaseExtensionSdk = {
  extensions: {
    create(params: { file: ReturnType<typeof createReadStream> }): Promise<{ id: string }>;
    delete(
      extensionId: string,
      options?: { headers?: Record<string, string | null> },
    ): Promise<void>;
  };
};

type BrowserbaseSdkFactory = (apiKey: string) => BrowserbaseExtensionSdk;

export async function createBrowserbaseExtensionArchive(
  extensionDir = DEFAULT_EXTENSION_DIR,
): Promise<BrowserbaseExtensionArchive> {
  const files = await readExtensionFiles(extensionDir);
  if (!("manifest.json" in files)) {
    throw new Error(`Stagehand extension manifest was not found in ${extensionDir}`);
  }

  const temporaryDirectory = await mkdtemp(path.join(tmpdir(), "stagehand-browserbase-extension-"));
  const archivePath = path.join(temporaryDirectory, "stagehand-extension.zip");

  try {
    await writeFile(archivePath, await createZip(files));
  } catch (error) {
    await rm(temporaryDirectory, { force: true, recursive: true });
    throw error;
  }

  let cleaned = false;
  return {
    path: archivePath,
    async cleanup() {
      if (cleaned) return;
      await rm(temporaryDirectory, { force: true, recursive: true });
      cleaned = true;
    },
  };
}

export function createBrowserbaseExtensionClient(
  apiKey: string,
  createSdk: BrowserbaseSdkFactory = (key) => new Browserbase({ apiKey: key }),
): BrowserbaseExtensionClient {
  const browserbase = createSdk(apiKey);
  return {
    async uploadExtension(archivePath) {
      const extension = await browserbase.extensions.create({
        file: createReadStream(archivePath),
      });
      return { id: extension.id };
    },
    async deleteExtension(extensionId) {
      await browserbase.extensions.delete(extensionId, {
        headers: { "Content-Type": null },
      });
    },
  };
}

export async function provisionBrowserbaseExtension(
  client: BrowserbaseExtensionClient,
  extensionDir = DEFAULT_EXTENSION_DIR,
): Promise<ProvisionedBrowserbaseExtension> {
  const archive = await createBrowserbaseExtensionArchive(extensionDir);
  let uploaded: { id: string };

  try {
    uploaded = await client.uploadExtension(archive.path);
  } catch (error) {
    await archive.cleanup().catch(() => undefined);
    throw new Error("Failed to upload the Stagehand extension to Browserbase", { cause: error });
  }
  await archive.cleanup();

  const extensionId = uploaded.id.trim();
  if (extensionId.length === 0) {
    throw new Error("Browserbase extension upload returned an empty extension ID");
  }

  let cleaned = false;
  return {
    extensionId,
    async cleanup() {
      if (cleaned) return;
      await client.deleteExtension(extensionId);
      cleaned = true;
    },
  };
}

async function readExtensionFiles(
  directory: string,
  relativeDirectory = "",
): Promise<Record<string, Uint8Array>> {
  const absoluteDirectory = path.join(directory, relativeDirectory);
  const entries = await readdir(absoluteDirectory, { withFileTypes: true });
  const files: Record<string, Uint8Array> = {};

  for (const entry of entries.toSorted((left, right) => left.name.localeCompare(right.name))) {
    const relativePath = path.join(relativeDirectory, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`Stagehand extension archive cannot contain symbolic links: ${relativePath}`);
    }
    if (entry.isDirectory()) {
      Object.assign(files, await readExtensionFiles(directory, relativePath));
      continue;
    }
    if (!entry.isFile()) {
      throw new Error(`Stagehand extension archive contains an unsupported entry: ${relativePath}`);
    }
    files[relativePath.split(path.sep).join("/")] = await readFile(
      path.join(directory, relativePath),
    );
  }

  return files;
}

async function createZip(files: Record<string, Uint8Array>): Promise<Uint8Array> {
  return await new Promise((resolve, reject) => {
    zip(files, { level: 6 }, (error, data) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(data);
    });
  });
}
