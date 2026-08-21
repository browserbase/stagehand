import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { zipSync, type Zippable } from "fflate";
import { defineConfig, loadEnv, type UserConfig } from "vite";
import { STAGEHAND_PROTOCOL_VERSION } from "../protocol/schemas.js";
import { instrumentedDecoratorBuild } from "./instrumentedDecoratorBuild.ts";
import packageJson from "./package.json" with { type: "json" };

const root = import.meta.dirname;
const zipModifiedAt = new Date(1980, 0, 1);

export function validateBrowserProxyOrigin(rawValue: string): void {
  let url: URL;
  try {
    url = new URL(rawValue.trim());
  } catch (error) {
    throw new Error("Resident browser proxy URL must be a valid URL", { cause: error });
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Resident browser proxy URL must use http: or https:");
  }
  if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost" && url.hostname !== "[::1]") {
    throw new Error("Resident browser proxy URL must point to loopback");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("Resident browser proxy URL must not include credentials, query, or fragment");
  }
  if (url.pathname !== "/") {
    throw new Error("Resident browser proxy URL must contain only an origin");
  }
}

export function stagehandExtensionBuildConfig(options: {
  mode: string;
  outDir?: string;
  artifactsDir?: string;
}): UserConfig {
  const outDir = options.outDir ?? path.join(root, "dist");
  const artifactsDir = options.artifactsDir ?? path.join(root, "artifacts");
  const env = loadEnv(options.mode, root, "VITE_STAGEHAND_");
  const browserProxyOrigin = (
    process.env.VITE_STAGEHAND_BROWSER_PROXY_URL ??
    env.VITE_STAGEHAND_BROWSER_PROXY_URL ??
    ""
  ).trim();
  if (browserProxyOrigin) validateBrowserProxyOrigin(browserProxyOrigin);
  const residentGatewayConfigured = browserProxyOrigin.length > 0;

  return {
    root,
    build: {
      emptyOutDir: true,
      minify: "oxc",
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
          // Decorated handlers and the RPC router rely on stable runtime names.
          minify: {
            compress: { keepNames: { function: true, class: true } },
            mangle: { keepNames: { function: true, class: true } },
          },
        },
      },
    },
    plugins: [
      instrumentedDecoratorBuild(),
      buildExtensionArtifacts({ outDir, artifactsDir, residentGatewayConfigured }),
    ],
  };
}

function buildExtensionArtifacts(options: {
  outDir: string;
  artifactsDir: string;
  residentGatewayConfigured: boolean;
}) {
  const { outDir, artifactsDir, residentGatewayConfigured } = options;
  const extensionArchivePath = path.join(artifactsDir, "stagehand-extension.zip");
  const extensionMetadataPath = path.join(artifactsDir, "stagehand-extension.metadata.json");
  const temporaryArchivePath = `${extensionArchivePath}.${process.pid}.tmp`;
  const temporaryMetadataPath = `${extensionMetadataPath}.${process.pid}.tmp`;

  return {
    name: "stagehand-extension-artifacts",
    async buildStart() {
      await Promise.all([
        rm(extensionArchivePath, { force: true }),
        rm(extensionMetadataPath, { force: true }),
      ]);
    },
    async closeBundle() {
      try {
        await mkdir(outDir, { recursive: true });
        const manifest = JSON.parse(
          await readFile(path.join(root, "manifest.json"), "utf8"),
        ) as Record<string, unknown>;
        if (typeof manifest.key !== "string" || manifest.key.length === 0) {
          throw new Error("Stagehand extension manifest must contain a stable public key");
        }
        const extensionVersion = chromeManifestVersion(packageJson.version);
        await writeFile(
          path.join(outDir, "manifest.json"),
          `${JSON.stringify({ ...manifest, version: extensionVersion }, null, 2)}\n`,
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
        const metadata = `${JSON.stringify(
          {
            chromeExtensionId: chromeExtensionId(manifest.key),
            extensionVersion,
            stagehandProtocolVersion: STAGEHAND_PROTOCOL_VERSION,
            residentGatewayConfigured,
            sha256: createHash("sha256").update(archive).digest("hex"),
            unpackedSha256: await unpackedContentSha256(outDir),
            serviceWorkerPath: "service-worker.js",
            sourceCommit: sourceCommit(),
          },
          null,
          2,
        )}\n`;

        await mkdir(artifactsDir, { recursive: true });
        await writeFile(temporaryArchivePath, archive);
        await writeFile(temporaryMetadataPath, metadata);
        await rename(temporaryArchivePath, extensionArchivePath);
        await rename(temporaryMetadataPath, extensionMetadataPath);
      } catch (error) {
        await Promise.all([
          rm(outDir, { force: true, recursive: true }),
          rm(extensionArchivePath, { force: true }),
          rm(extensionMetadataPath, { force: true }),
        ]);
        throw error;
      } finally {
        await Promise.all([
          rm(temporaryArchivePath, { force: true }),
          rm(temporaryMetadataPath, { force: true }),
        ]);
      }
    },
  };
}

function chromeExtensionId(publicKey: string): string {
  return createHash("sha256")
    .update(Buffer.from(publicKey, "base64"))
    .digest("hex")
    .slice(0, 32)
    .replace(/[0-9a-f]/gu, (digit) =>
      String.fromCharCode("a".charCodeAt(0) + Number.parseInt(digit, 16)),
    );
}

// `sourceCommit` identifies the commit whose inputs produced these bytes, not necessarily the
// commit the build ran on: GITHUB_SHA is deliberately excluded from this task's Turbo hash
// (`passThroughEnv`, not `env`), so Turbo may replay byte-identical artifacts — and therefore an
// older `sourceCommit` — across commits that did not change any extension input. Including
// GITHUB_SHA in the hash would rebuild the extension on every CI commit for no change in output;
// that cost is not worth it, so Cubic's P2 on this was deliberately resolved in favour of the
// cache. Consumers must treat `sourceCommit` as provenance for the inputs, and pin on `sha256` /
// `unpackedSha256` when they need to identify the bytes.
function sourceCommit(): string {
  const githubSha = process.env.GITHUB_SHA?.trim();
  if (githubSha) return githubSha;
  return execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: path.resolve(root, "../.."),
    encoding: "utf8",
  }).trim();
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

export async function unpackedContentSha256(directory: string): Promise<string> {
  const files = await readRegularFiles(directory);
  const digest = createHash("sha256");
  for (const relativePath of Object.keys(files).sort(compareCodePoints)) {
    digest.update(
      `${relativePath}\n${createHash("sha256").update(files[relativePath]!).digest("hex")}\n`,
    );
  }
  return digest.digest("hex");
}

async function readRegularFiles(
  directory: string,
  relativeDirectory = "",
): Promise<Record<string, Buffer>> {
  const files: Record<string, Buffer> = {};
  const entries = await readdir(path.join(directory, relativeDirectory), { withFileTypes: true });
  for (const entry of entries) {
    const relativePath = path.join(relativeDirectory, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`Stagehand extension cannot contain symbolic links: ${relativePath}`);
    }
    if (entry.isDirectory()) {
      Object.assign(files, await readRegularFiles(directory, relativePath));
    } else if (entry.isFile()) {
      files[relativePath.split(path.sep).join("/")] = await readFile(
        path.join(directory, relativePath),
      );
    } else {
      throw new Error(`Stagehand extension contains an unsupported entry: ${relativePath}`);
    }
  }
  return files;
}

export default defineConfig(({ mode }) => stagehandExtensionBuildConfig({ mode }));

// UTF-8 byte order equals Unicode code point order, matching Python's `sorted()` in build.py.
function compareCodePoints(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}
