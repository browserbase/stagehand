import { zipSync } from "fflate";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { fingerprintFiles } from "../../packages/extension/buildFingerprint.ts";
import { checkExtensionBuild, readBuildFingerprint } from "./check-extension-build.ts";

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

function zipFiles(files: Map<string, Uint8Array>): Uint8Array {
  return zipSync(Object.fromEntries(files));
}

async function releaseFixture(
  options: {
    extensionVersion?: string;
    protocolVersion?: string;
    typescriptFiles?: Map<string, Uint8Array>;
    wheelFiles?: Map<string, Uint8Array>;
  } = {},
) {
  const root = await mkdtemp(path.join(os.tmpdir(), "stagehand-extension-build-"));
  await writeTree(
    root,
    new Map([
      ["packages/extension/package.json", encoder.encode('{"version":"9.8.7"}')],
      ["packages/protocol/package.json", encoder.encode('{"version":"6.5.4"}')],
      [
        "packages/extension/artifacts/extension-build.json",
        encoder.encode(
          JSON.stringify({
            extensionVersion: options.extensionVersion ?? "9.8.7",
            protocolVersion: options.protocolVersion ?? "6.5.4",
            fingerprint: fingerprintFiles(extensionFiles),
          }),
        ),
      ],
    ]),
  );
  const typescriptDist = path.join(root, "packages/sdk-ts/dist");
  const typescriptFiles = options.typescriptFiles ?? extensionFiles;
  await writeTree(path.join(typescriptDist, "extension"), typescriptFiles);
  await writeTree(
    typescriptDist,
    new Map([["assets/stagehand-extension.zip", zipFiles(typescriptFiles)]]),
  );
  const wheel = path.join(root, "stagehand-4.4.0-py3-none-any.whl");
  await writeFile(
    wheel,
    zipSync({
      "stagehand/__init__.py": encoder.encode(""),
      // uv writes directory entries into wheels.
      "stagehand/_extension/": new Uint8Array(),
      "stagehand/_extension/offscreen/": new Uint8Array(),
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

function runCli(root: string, args: string[]) {
  return spawnSync(
    process.execPath,
    [
      "--import",
      import.meta.resolve("tsx"),
      path.join(import.meta.dirname, "check-extension-build.ts"),
      ...args,
    ],
    { cwd: root, encoding: "utf8" },
  );
}

async function buildFixture(distFiles = extensionFiles): Promise<string> {
  const { root } = await releaseFixture();
  await writeTree(path.join(root, "packages/extension/dist"), distFiles);
  return root;
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
    const { checked } = await checkExtensionBuild(root, { typescriptDist, wheel });
    expect(checked).toHaveLength(3);
  });

  it("accepts packages that match the expected fingerprint", async () => {
    const { root, typescriptDist, wheel } = await releaseFixture();
    const { checked } = await checkExtensionBuild(
      root,
      { typescriptDist, wheel },
      fingerprintFiles(extensionFiles),
    );
    expect(checked).toHaveLength(3);
  });

  it("rejects a build that differs from the expected fingerprint", async () => {
    const { root, wheel } = await releaseFixture();
    const expected = sha256("another build");
    const error = await checkExtensionBuild(root, { wheel }, expected).catch((caught) => caught);
    expect(error.message).toContain(`extension-build.json records fingerprint`);
    expect(error.message).toContain(`stagehand/_extension/ has fingerprint`);
    expect(error.message).toContain(`expected ${expected}`);
  });

  it("rejects an expected fingerprint that is not a SHA-256 digest", async () => {
    const { root, wheel } = await releaseFixture();
    await expect(checkExtensionBuild(root, { wheel }, "")).rejects.toThrow(
      "Expected fingerprint must be a SHA-256 hex digest",
    );
  });

  it("exits non-zero when a packaged copy differs", async () => {
    const wheelFiles = new Map(extensionFiles);
    wheelFiles.set("Zeta.js", encoder.encode("tampered\n"));
    const { root, wheel } = await releaseFixture({ wheelFiles });
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        import.meta.resolve("tsx"),
        path.join(import.meta.dirname, "check-extension-build.ts"),
        "--wheel",
        wheel,
      ],
      { cwd: root, encoding: "utf8" },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Packaged extension mismatch");
    expect(result.stdout).toBe("");
  });

  it("exits non-zero when the CLI's --expect differs from a consistent build", async () => {
    const { root, wheel } = await releaseFixture();
    const expected = sha256("another build");
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        import.meta.resolve("tsx"),
        path.join(import.meta.dirname, "check-extension-build.ts"),
        "--wheel",
        wheel,
        "--expect",
        expected,
      ],
      { cwd: root, encoding: "utf8" },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`expected ${expected}`);
    expect(result.stdout).toBe("");
  });

  it("rejects a packaged copy that differs from the release build", async () => {
    const wheelFiles = new Map(extensionFiles);
    wheelFiles.set("Zeta.js", encoder.encode("tampered\n"));
    const { root, wheel } = await releaseFixture({ wheelFiles });
    await expect(checkExtensionBuild(root, { wheel })).rejects.toThrow(
      "stagehand/_extension/ has fingerprint",
    );
  });

  it("rejects a TypeScript package whose zip and folder differ from the release build", async () => {
    const typescriptFiles = new Map(extensionFiles);
    typescriptFiles.set("Zeta.js", encoder.encode("tampered\n"));
    const { root, typescriptDist } = await releaseFixture({ typescriptFiles });
    const error = await checkExtensionBuild(root, { typescriptDist }).catch((caught) => caught);
    expect(error.message).toContain(`${path.join("assets", "stagehand-extension.zip")} has`);
    expect(error.message).toContain(`${path.join(typescriptDist, "extension")} has`);
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
      "built for protocol 3.1.2-alpha-0123456, protocol is now 6.5.4",
    );
  });

  it("rejects an extension built at another extension version", async () => {
    const { root, typescriptDist } = await releaseFixture({ extensionVersion: "9.8.6" });
    await expect(checkExtensionBuild(root, { typescriptDist })).rejects.toThrow(
      "built at version 9.8.6, package is now 9.8.7",
    );
  });

  it("requires something to check", async () => {
    const { root } = await releaseFixture();
    await expect(checkExtensionBuild(root, {})).rejects.toThrow("Pass --typescript and/or --wheel");
  });
});

describe("readBuildFingerprint", () => {
  it("returns the recorded fingerprint when it matches dist", async () => {
    const root = await buildFixture();
    await expect(readBuildFingerprint(root)).resolves.toBe(fingerprintFiles(extensionFiles));
  });

  it("rejects a recorded fingerprint that differs from dist", async () => {
    const distFiles = new Map(extensionFiles);
    distFiles.set("Zeta.js", encoder.encode("tampered\n"));
    const root = await buildFixture(distFiles);
    await expect(readBuildFingerprint(root)).rejects.toThrow(
      `records fingerprint ${fingerprintFiles(extensionFiles)}, dist has ${fingerprintFiles(distFiles)}`,
    );
  });

  it("rejects a recorded fingerprint that is not a SHA-256 digest", async () => {
    const root = await buildFixture();
    const infoPath = path.join(root, "packages/extension/artifacts/extension-build.json");
    const info = JSON.parse(await readFile(infoPath, "utf8"));
    await writeFile(
      infoPath,
      JSON.stringify({ ...info, fingerprint: info.fingerprint.toUpperCase() }),
    );
    await expect(readBuildFingerprint(root)).rejects.toThrow("is not a SHA-256 hex digest");
  });

  it("prints only the fingerprint from the CLI", async () => {
    const root = await buildFixture();
    const result = runCli(root, ["--print-fingerprint"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe(`${fingerprintFiles(extensionFiles)}\n`);
  });

  it("exits non-zero and prints nothing on stdout when dist differs", async () => {
    const distFiles = new Map(extensionFiles);
    distFiles.set("Zeta.js", encoder.encode("tampered\n"));
    const root = await buildFixture(distFiles);
    const result = runCli(root, ["--print-fingerprint"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("dist has");
    expect(result.stdout).toBe("");
  });
});
