import { cp, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { zipSync, type Zippable } from "fflate";
import { build, defineConfig, type Plugin } from "vite";
import { instrumentedDecoratorBuild } from "./instrumentedDecoratorBuild.ts";
import packageJson from "./package.json" with { type: "json" };
import { EXTENSION_BUILD_ID_FILE, STAGEHAND_EXTENSION_BUILD_ID } from "./version.ts";
import protocolPackageJson from "../protocol/package.json" with { type: "json" };
import {
  EXTENSION_BUILD_INFO_FILE,
  fingerprintFiles,
  readDirectoryFiles,
  type ExtensionBuildInfo,
} from "./buildFingerprint.ts";

const root = import.meta.dirname;
const outDir = path.join(root, "dist");
const artifactsDir = path.join(root, "artifacts");
const extensionArchivePath = path.join(artifactsDir, "stagehand-extension.zip");
const deterministicZipModifiedAt = new Date(1980, 0, 1);

// Content scripts are classic scripts, so they cannot import chunks shared with
// the module service worker. Bundle this entry independently, including its scope.
function standaloneContentScript(): Plugin {
  return {
    name: "stagehand-extension-content-script",
    async generateBundle() {
      const result = await build({
        configFile: false,
        build: {
          write: false,
          minify: "oxc",
          target: "es2022",
          lib: {
            entry: path.join(root, "content-script.ts"),
            formats: ["iife"],
            name: "StagehandContentScript",
            fileName: () => "content-script.js",
          },
        },
      });
      for (const output of Array.isArray(result) ? result : [result]) {
        if (!("output" in output)) throw new Error("Unexpected content script build result");
        for (const file of output.output) {
          this.emitFile({
            type: "asset",
            fileName: file.fileName,
            source: file.type === "chunk" ? file.code : file.source,
          });
        }
      }
    },
  };
}

function buildExtensionArtifacts(): Plugin {
  let rejectedBundle = false;
  return {
    name: "stagehand-extension-artifacts",
    generateBundle(_options, bundle) {
      rejectedBundle = false;
      // Minified output no longer carries the placeholder's name, so check the module graph.
      for (const [file, output] of Object.entries(bundle)) {
        if (output.type !== "chunk") continue;
        if (output.moduleIds.some((id) => id.includes("__vite-browser-external"))) {
          rejectedBundle = true;
          throw new Error(`${file} bundles a Node built-in, which the extension cannot load`);
        }
      }
    },
    async closeBundle() {
      // Nothing was written; let the build error surface instead of a missing-file one.
      if (rejectedBundle) return;
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

      await stampBuildId(outDir);
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

      const buildInfo: ExtensionBuildInfo = {
        extensionVersion: packageJson.version,
        protocolVersion: protocolPackageJson.version,
        fingerprint: fingerprintFiles(await readDirectoryFiles(outDir)),
      };
      await writeFile(
        path.join(artifactsDir, EXTENSION_BUILD_INFO_FILE),
        `${JSON.stringify(buildInfo, null, 2)}\n`,
      );
    },
  };
}

// The unstamped build's fingerprint: the shipped fingerprint hashes the stamped files themselves.
async function stampBuildId(directory: string): Promise<void> {
  const files = await readDirectoryFiles(directory);
  const buildId = fingerprintFiles(files);
  let stamped = false;
  for (const [relativePath, contents] of files) {
    if (!relativePath.endsWith(".js")) continue;
    const source = Buffer.from(contents).toString("utf8");
    if (!source.includes(STAGEHAND_EXTENSION_BUILD_ID)) continue;
    await writeFile(
      path.join(directory, relativePath),
      source.replaceAll(STAGEHAND_EXTENSION_BUILD_ID, buildId),
    );
    stamped = true;
  }
  if (!stamped)
    throw new Error("The extension build does not contain the build identity placeholder");
  await writeFile(path.join(directory, EXTENSION_BUILD_ID_FILE), `${buildId}\n`);
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
      { attrs: 0o644 << 16, mtime: deterministicZipModifiedAt, os: 3 },
    ];
  }

  return files;
}

export default defineConfig({
  build: {
    emptyOutDir: true,
    minify: "oxc",
    modulePreload: false,
    outDir,
    target: "es2022",
    rolldownOptions: {
      input: {
        "service-worker": path.join(root, "service-worker.ts"),
        "offscreen/service-worker-heartbeat": path.join(
          root,
          "service-worker-lifecycle/heartbeat.ts",
        ),
        "wake-service-worker": path.join(root, "service-worker-lifecycle/wake.ts"),
      },
      output: {
        entryFileNames: "[name].js",
        // `build.minify` turns minification on and this object adds keepNames, so stack traces
        // and logs stay readable. To turn minification off, set `build.minify: false` and remove
        // this object; either one alone still minifies.
        minify: {
          compress: { keepNames: { function: true, class: true } },
          mangle: { keepNames: { function: true, class: true } },
        },
      },
    },
  },
  plugins: [instrumentedDecoratorBuild(), standaloneContentScript(), buildExtensionArtifacts()],
});
