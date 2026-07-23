import { cp, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { zipSync, type Zippable } from "fflate";
import { defineConfig } from "vite-plus";
import { instrumentedDecoratorBuild } from "./instrumentedDecoratorBuild.ts";
import packageJson from "./package.json" with { type: "json" };

const root = import.meta.dirname;
const outDir = path.join(root, "dist");
const artifactsDir = path.join(root, "artifacts");
const extensionArchivePath = path.join(artifactsDir, "stagehand-extension.zip");
const zipModifiedAt = new Date(1980, 0, 1);

function buildExtensionArtifacts() {
  return {
    name: "stagehand-extension-artifacts",
    async closeBundle() {
      await mkdir(outDir, { recursive: true });
      const manifest = JSON.parse(
        await readFile(path.join(root, "manifest.json"), "utf8"),
      ) as Record<string, unknown>;
      await writeFile(
        path.join(outDir, "manifest.json"),
        `${JSON.stringify({ ...manifest, version: chromeManifestVersion(packageJson.version) }, null, 2)}\n`,
      );
      await cp(path.join(root, "blank.html"), path.join(outDir, "blank.html"));
      await cp(
        path.join(root, "service-worker-lifecycle/wake.html"),
        path.join(outDir, "wake-service-worker.html"),
      );
      await mkdir(path.join(outDir, "offscreen"), { recursive: true });
      await cp(
        path.join(root, "service-worker-lifecycle/heartbeat.html"),
        path.join(outDir, "offscreen/service-worker-heartbeat.html"),
      );

      await validateExtension(outDir);
      const archive = zipSync(await readExtensionFiles(outDir), { level: 9 });
      await mkdir(artifactsDir, { recursive: true });
      const temporaryArchivePath = `${extensionArchivePath}.${process.pid}.tmp`;
      try {
        await writeFile(temporaryArchivePath, archive);
        await rename(temporaryArchivePath, extensionArchivePath);
      } finally {
        await rm(temporaryArchivePath, { force: true });
      }
    },
  };
}

function chromeManifestVersion(version: string): string {
  const release = version.replace(/[+-].*$/u, "");
  if (!/^\d+(?:\.\d+){0,3}$/u.test(release)) {
    throw new Error(`Invalid Chrome extension version derived from package.json: ${version}`);
  }
  return release;
}

async function validateExtension(directory: string): Promise<void> {
  const manifest = JSON.parse(await readFile(path.join(directory, "manifest.json"), "utf8")) as {
    manifest_version?: unknown;
    background?: { service_worker?: unknown };
    options_page?: unknown;
  };
  if (manifest.manifest_version !== 3) {
    throw new Error("Stagehand extension manifest must use manifest_version 3");
  }

  const referencedFiles = [
    manifest.background?.service_worker,
    manifest.options_page,
    "offscreen/service-worker-heartbeat.html",
    "offscreen/service-worker-heartbeat.js",
  ];
  for (const relativePath of referencedFiles) {
    if (typeof relativePath !== "string" || relativePath.length === 0) {
      throw new Error("Stagehand extension manifest contains an invalid file reference");
    }
    await readFile(path.join(directory, relativePath));
  }
}

async function readExtensionFiles(directory: string, relativeDirectory = ""): Promise<Zippable> {
  const absoluteDirectory = path.join(directory, relativeDirectory);
  const entries = await readdir(absoluteDirectory, { withFileTypes: true });
  const files: Zippable = {};

  for (const entry of entries.toSorted((left, right) => left.name.localeCompare(right.name))) {
    const relativePath = path.join(relativeDirectory, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`Stagehand extension cannot contain symbolic links: ${relativePath}`);
    }
    if (entry.isDirectory()) {
      Object.assign(files, await readExtensionFiles(directory, relativePath));
      continue;
    }
    if (!entry.isFile()) {
      throw new Error(`Stagehand extension contains an unsupported entry: ${relativePath}`);
    }
    files[relativePath.split(path.sep).join("/")] = [
      await readFile(path.join(directory, relativePath)),
      { attrs: 0o644 << 16, mtime: zipModifiedAt, os: 3 },
    ];
  }

  return files;
}

export default defineConfig({
  build: {
    emptyOutDir: true,
    minify: false,
    modulePreload: false,
    outDir,
    target: "es2022",
    rolldownOptions: {
      input: {
        "service-worker": path.join(root, "service-worker.ts"),
        "content-script": path.join(root, "content-script.ts"),
        "offscreen/service-worker-heartbeat": path.join(
          root,
          "service-worker-lifecycle/heartbeat.ts",
        ),
        "wake-service-worker": path.join(root, "service-worker-lifecycle/wake.ts"),
      },
      output: {
        entryFileNames: "[name].js",
      },
    },
  },
  plugins: [instrumentedDecoratorBuild(), buildExtensionArtifacts()],
});
