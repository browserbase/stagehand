import { zipSync } from "fflate";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { fingerprintFiles } from "../../packages/extension/buildFingerprint.ts";
import { checkExtensionBuild, readBuildFingerprint } from "./check-extension-build.ts";

function packageLabels(typescriptDist: string, wheel: string): string[] {
  return [
    path.join(typescriptDist, "assets/stagehand-extension.zip"),
    path.join(typescriptDist, "extension"),
    `${wheel}:stagehand/_extension/`,
    path.join(typescriptDist, "assets", "extension-build.json"),
    `${wheel}:stagehand/_extension_build.json`,
  ];
}

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
    embeddedBuildInfo?: string | null;
  } = {},
) {
  const buildInfo = encoder.encode(
    JSON.stringify({
      extensionVersion: options.extensionVersion ?? "9.8.7",
      protocolVersion: options.protocolVersion ?? "6.5.4",
      fingerprint: fingerprintFiles(extensionFiles),
    }),
  );
  const embeddedBuildInfo =
    options.embeddedBuildInfo === null
      ? undefined
      : options.embeddedBuildInfo === undefined
        ? buildInfo
        : encoder.encode(options.embeddedBuildInfo);
  const root = await mkdtemp(path.join(os.tmpdir(), "stagehand-extension-build-"));
  await writeTree(
    root,
    new Map([
      ["packages/extension/package.json", encoder.encode('{"version":"9.8.7"}')],
      ["packages/protocol/package.json", encoder.encode('{"version":"6.5.4"}')],
      ["packages/extension/artifacts/extension-build.json", buildInfo],
    ]),
  );
  const typescriptDist = path.join(root, "packages/sdk-ts/dist");
  const typescriptFiles = options.typescriptFiles ?? extensionFiles;
  await writeTree(path.join(typescriptDist, "extension"), typescriptFiles);
  await writeTree(
    typescriptDist,
    new Map([
      ["assets/stagehand-extension.zip", zipFiles(typescriptFiles)],
      ...(embeddedBuildInfo ? [["assets/extension-build.json", embeddedBuildInfo] as const] : []),
    ]),
  );
  const wheel = path.join(root, "stagehand-4.4.0-py3-none-any.whl");
  await writeFile(
    wheel,
    zipSync({
      "stagehand/__init__.py": encoder.encode(""),
      ...(embeddedBuildInfo ? { "stagehand/_extension_build.json": embeddedBuildInfo } : {}),
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
    expect(checked).toEqual(packageLabels(typescriptDist, wheel));
  });

  it("checks only the TypeScript package when given --typescript", async () => {
    const { root, typescriptDist, wheel } = await releaseFixture();
    const { checked } = await checkExtensionBuild(root, { typescriptDist });
    expect(checked).toEqual(
      packageLabels(typescriptDist, wheel).filter((label) => !label.startsWith(wheel)),
    );
  });

  it("checks only the wheel when given --wheel", async () => {
    const { root, typescriptDist, wheel } = await releaseFixture();
    const { checked } = await checkExtensionBuild(root, { wheel });
    expect(checked).toEqual(
      packageLabels(typescriptDist, wheel).filter((label) => label.startsWith(wheel)),
    );
  });

  it("prints both build files when the embedded one differs", async () => {
    const embedded = JSON.stringify({ fingerprint: fingerprintFiles(extensionFiles) });
    const { root, wheel } = await releaseFixture({ embeddedBuildInfo: embedded });
    const release = await readFile(
      path.join(root, "packages/extension/artifacts/extension-build.json"),
      "utf8",
    );
    const error = await checkExtensionBuild(root, { wheel }).catch((caught) => caught);
    expect(error.message).toContain(`packaged ${JSON.stringify(embedded)}`);
    expect(error.message).toContain(`release ${JSON.stringify(release)}`);
  });

  it.each([
    ["typescript", "differs", "assets/extension-build.json differs from the release"],
    ["typescript", "missing", "assets/extension-build.json is missing"],
    ["wheel", "differs", "stagehand/_extension_build.json differs from the release"],
    ["wheel", "missing", "stagehand/_extension_build.json is missing"],
  ] as const)(
    "rejects a %s package whose embedded build info %s",
    async (side, problem, message) => {
      const { root, typescriptDist, wheel } = await releaseFixture({
        embeddedBuildInfo:
          problem === "missing"
            ? null
            : JSON.stringify({ fingerprint: fingerprintFiles(extensionFiles) }),
      });
      const packaged = side === "typescript" ? { typescriptDist } : { wheel };
      await expect(checkExtensionBuild(root, packaged)).rejects.toThrow(
        side === "typescript" ? path.join(typescriptDist, message) : message,
      );
    },
  );

  it("accepts packages that match the expected fingerprint", async () => {
    const { root, typescriptDist, wheel } = await releaseFixture();
    const { checked } = await checkExtensionBuild(
      root,
      { typescriptDist, wheel },
      fingerprintFiles(extensionFiles),
    );
    expect(checked).toEqual(packageLabels(typescriptDist, wheel));
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

  it("exits non-zero when the CLI's --expect is empty", async () => {
    const { root, wheel } = await releaseFixture();
    const result = runCli(root, ["--wheel", wheel, "--expect", ""]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Expected fingerprint must be a SHA-256 hex digest");
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

  it.each(["zip", "folder"] as const)(
    "names only the TypeScript %s when it alone differs from the release build",
    async (copy) => {
      const { root, typescriptDist } = await releaseFixture();
      const tampered = new Map(extensionFiles).set("Zeta.js", encoder.encode("tampered\n"));
      const zip = path.join(typescriptDist, "assets/stagehand-extension.zip");
      const folder = path.join(typescriptDist, "extension");
      if (copy === "zip") await writeFile(zip, zipFiles(tampered));
      else await writeTree(folder, tampered);
      const error = await checkExtensionBuild(root, { typescriptDist }).catch((caught) => caught);
      const [bad, good] = copy === "zip" ? [zip, folder] : [folder, zip];
      expect(error.message).toContain(`${bad} has fingerprint`);
      expect(error.message).not.toContain(`${good} has fingerprint`);
    },
  );

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

  it("still compares versions when an expected fingerprint is given", async () => {
    const { root, typescriptDist } = await releaseFixture({
      protocolVersion: "3.1.2-alpha-0123456",
    });
    await expect(
      checkExtensionBuild(root, { typescriptDist }, fingerprintFiles(extensionFiles)),
    ).rejects.toThrow("built for protocol 3.1.2-alpha-0123456, protocol is now 6.5.4");
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
