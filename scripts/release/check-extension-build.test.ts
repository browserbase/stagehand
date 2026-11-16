import { zipSync } from "fflate";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { fingerprintFiles } from "../../packages/extension/buildFingerprint.ts";
import { checkExtensionBuild } from "./check-extension-build.ts";

const encoder = new TextEncoder();
const extensionFiles = new Map([
  ["manifest.json", encoder.encode('{"manifest_version":3}\n')],
  ["Zeta.js", encoder.encode("zeta\n")],
  ["offscreen/heartbeat.js", encoder.encode("heartbeat\n")],
]);

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

async function writeTree(root: string, files: Map<string, Uint8Array>): Promise<void> {
  for (const [relativePath, contents] of files) {
    await mkdir(path.dirname(path.join(root, relativePath)), { recursive: true });
    await writeFile(path.join(root, relativePath), contents);
  }
}

function zipFiles(files: Map<string, Uint8Array>, prefix = ""): Uint8Array {
  return zipSync(
    Object.fromEntries([...files].map(([name, contents]) => [`${prefix}${name}`, contents])),
  );
}

async function releaseFixture(
  options: { protocolVersion?: string; wheelFiles?: Map<string, Uint8Array> } = {},
) {
  const root = await mkdtemp(path.join(os.tmpdir(), "stagehand-extension-build-"));
  await writeTree(
    root,
    new Map([
      ["packages/extension/package.json", encoder.encode('{"version":"1.3.0"}')],
      ["packages/protocol/package.json", encoder.encode('{"version":"3.1.1"}')],
      [
        "packages/extension/artifacts/extension-build.json",
        encoder.encode(
          JSON.stringify({
            extensionVersion: "1.3.0",
            protocolVersion: options.protocolVersion ?? "3.1.1",
            fingerprint: fingerprintFiles(extensionFiles),
          }),
        ),
      ],
    ]),
  );
  const typescriptDist = path.join(root, "packages/sdk-ts/dist");
  await writeTree(path.join(typescriptDist, "extension"), extensionFiles);
  await writeTree(
    typescriptDist,
    new Map([["assets/stagehand-extension.zip", zipFiles(extensionFiles)]]),
  );
  const wheel = path.join(root, "stagehand-4.4.0-py3-none-any.whl");
  await writeFile(
    wheel,
    zipSync({
      "stagehand/__init__.py": encoder.encode(""),
      ...Object.fromEntries(
        [...(options.wheelFiles ?? extensionFiles)].map(([name, contents]) => [
          `stagehand/_extension/${name}`,
          contents,
        ]),
      ),
    }),
  );
  return { root, typescriptDist, wheel };
}

describe("fingerprintFiles", () => {
  it("hashes sha256sum-style lines sorted by path bytes", () => {
    // SHA-256 of "<sha256 hex of content>  <posix path>\n" per file, sorted by UTF-8 path bytes.
    const expected = sha256(
      [
        `${sha256("zeta\n")}  Zeta.js\n`,
        `${sha256('{"manifest_version":3}\n')}  manifest.json\n`,
        `${sha256("heartbeat\n")}  offscreen/heartbeat.js\n`,
      ].join(""),
    );
    expect(fingerprintFiles(extensionFiles)).toBe(expected);
  });
});

describe("checkExtensionBuild", () => {
  it("accepts TypeScript and Python packages that carry the release build", async () => {
    const { root, typescriptDist, wheel } = await releaseFixture();
    await expect(checkExtensionBuild(root, { typescriptDist, wheel })).resolves.toHaveLength(3);
  });

  it("rejects a packaged copy that differs from the release build", async () => {
    const wheelFiles = new Map(extensionFiles);
    wheelFiles.set("Zeta.js", encoder.encode("tampered\n"));
    const { root, wheel } = await releaseFixture({ wheelFiles });
    await expect(checkExtensionBuild(root, { wheel })).rejects.toThrow(
      "stagehand/_extension/ has fingerprint",
    );
  });

  it("rejects a wheel without the extension", async () => {
    const { root, wheel } = await releaseFixture({ wheelFiles: new Map() });
    await expect(checkExtensionBuild(root, { wheel })).rejects.toThrow("has fingerprint no files");
  });

  it("rejects an extension built for another protocol version", async () => {
    const { root, typescriptDist } = await releaseFixture({
      protocolVersion: "3.1.2-alpha-0123456",
    });
    await expect(checkExtensionBuild(root, { typescriptDist })).rejects.toThrow(
      "built for protocol 3.1.2-alpha-0123456, protocol is now 3.1.1",
    );
  });

  it("requires something to check", async () => {
    const { root } = await releaseFixture();
    await expect(checkExtensionBuild(root, {})).rejects.toThrow("Pass --typescript and/or --wheel");
  });
});
