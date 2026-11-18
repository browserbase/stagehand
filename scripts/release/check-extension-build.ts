import { unzipSync } from "fflate";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import {
  EXTENSION_BUILD_INFO_FILE,
  fingerprintFiles,
  readDirectoryFiles,
  type ExtensionBuildInfo,
} from "../../packages/extension/buildFingerprint.ts";

const WHEEL_EXTENSION_PREFIX = "stagehand/_extension/";

export type PackagedExtensions = {
  typescriptDist?: string;
  wheel?: string;
};

export async function checkExtensionBuild(
  repositoryRoot: string,
  packaged: PackagedExtensions,
  expectedFingerprint?: string,
): Promise<{ info: ExtensionBuildInfo; checked: string[] }> {
  if (expectedFingerprint !== undefined && !/^[0-9a-f]{64}$/.test(expectedFingerprint)) {
    throw new Error(
      `Expected fingerprint must be a SHA-256 hex digest, got "${expectedFingerprint}"`,
    );
  }
  const extensionRoot = path.join(repositoryRoot, "packages/extension");
  const info = JSON.parse(
    await readFile(path.join(extensionRoot, "artifacts", EXTENSION_BUILD_INFO_FILE), "utf8"),
  ) as ExtensionBuildInfo;
  const extensionVersion = await packageVersion(extensionRoot);
  const protocolVersion = await packageVersion(path.join(repositoryRoot, "packages/protocol"));

  const errors: string[] = [];
  const expected = expectedFingerprint ?? info.fingerprint;
  if (info.fingerprint !== expected) {
    errors.push(
      `${EXTENSION_BUILD_INFO_FILE} records fingerprint ${info.fingerprint}, expected ${expected}`,
    );
  }
  if (info.extensionVersion !== extensionVersion) {
    errors.push(
      `extension was built at version ${info.extensionVersion}, package is now ${extensionVersion}`,
    );
  }
  if (info.protocolVersion !== protocolVersion) {
    errors.push(
      `extension was built for protocol ${info.protocolVersion}, protocol is now ${protocolVersion}`,
    );
  }

  const copies = new Map<string, () => Promise<Map<string, Uint8Array>>>();
  if (packaged.typescriptDist !== undefined) {
    const dist = packaged.typescriptDist;
    copies.set(path.join(dist, "assets/stagehand-extension.zip"), async () =>
      unzipFiles(await readFile(path.join(dist, "assets/stagehand-extension.zip"))),
    );
    copies.set(path.join(dist, "extension"), () =>
      readDirectoryFiles(path.join(dist, "extension")),
    );
  }
  if (packaged.wheel !== undefined) {
    const wheel = packaged.wheel;
    copies.set(`${wheel}:${WHEEL_EXTENSION_PREFIX}`, async () =>
      unzipFiles(await readFile(wheel), WHEEL_EXTENSION_PREFIX),
    );
  }
  if (copies.size === 0) throw new Error("Pass --typescript and/or --wheel to check");

  for (const [label, read] of copies) {
    const files = await read();
    const fingerprint = files.size === 0 ? "no files" : fingerprintFiles(files);
    if (fingerprint !== expected) {
      errors.push(`${label} has fingerprint ${fingerprint}, expected ${expected}`);
    }
  }
  if (errors.length > 0) throw new Error(`Packaged extension mismatch:\n- ${errors.join("\n- ")}`);
  return { info, checked: [...copies.keys()] };
}

export async function readBuildFingerprint(repositoryRoot: string): Promise<string> {
  const extensionRoot = path.join(repositoryRoot, "packages/extension");
  const { fingerprint } = JSON.parse(
    await readFile(path.join(extensionRoot, "artifacts", EXTENSION_BUILD_INFO_FILE), "utf8"),
  ) as ExtensionBuildInfo;
  if (typeof fingerprint !== "string" || !/^[0-9a-f]{64}$/.test(fingerprint)) {
    throw new Error(`${EXTENSION_BUILD_INFO_FILE} fingerprint is not a SHA-256 hex digest`);
  }
  const dist = fingerprintFiles(await readDirectoryFiles(path.join(extensionRoot, "dist")));
  if (dist !== fingerprint) {
    throw new Error(
      `${EXTENSION_BUILD_INFO_FILE} records fingerprint ${fingerprint}, dist has ${dist}`,
    );
  }
  return fingerprint;
}

function unzipFiles(archive: Uint8Array, prefix = ""): Map<string, Uint8Array> {
  const files = new Map<string, Uint8Array>();
  const entries = unzipSync(archive, {
    filter: ({ name }) => name.startsWith(prefix) && !name.endsWith("/"),
  });
  for (const [name, contents] of Object.entries(entries)) {
    files.set(name.slice(prefix.length), contents);
  }
  return files;
}

async function packageVersion(directory: string): Promise<string> {
  return (
    JSON.parse(await readFile(path.join(directory, "package.json"), "utf8")) as {
      version: string;
    }
  ).version;
}

const invokedPath = process.argv[1];
if (
  invokedPath !== undefined &&
  import.meta.url === pathToFileURL(path.resolve(invokedPath)).href
) {
  const { values } = parseArgs({
    options: {
      typescript: { type: "string" },
      wheel: { type: "string" },
      expect: { type: "string" },
      "print-fingerprint": { type: "boolean" },
    },
  });
  try {
    if (values["print-fingerprint"]) {
      process.stdout.write(`${await readBuildFingerprint(process.cwd())}\n`);
    } else {
      const { info, checked } = await checkExtensionBuild(
        process.cwd(),
        { typescriptDist: values.typescript, wheel: values.wheel },
        values.expect,
      );
      process.stdout.write(
        `Packaged extension matches the release build (fingerprint ${info.fingerprint}, extension ${info.extensionVersion}, protocol ${info.protocolVersion}): ${checked.join(", ")}\n`,
      );
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
