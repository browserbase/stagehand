import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { scopedChangesets } from "./release-scope.ts";
import {
  assertPublishedCliDependencies,
  isCliVersionPublished,
  versionScope,
  withPublishScope,
} from "./scoped-release.ts";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function fixture(changes: "both" | "cli" | "sdk" | "mixed" = "both") {
  const root = await mkdtemp(path.join(os.tmpdir(), "scoped-release-"));
  directories.push(root);
  await mkdir(path.join(root, ".changeset"));
  await writeFile(
    path.join(root, "package.json"),
    JSON.stringify({ name: "fixture", private: true }),
  );
  await writeFile(path.join(root, "pnpm-workspace.yaml"), 'packages:\n  - "packages/*"\n');
  await writeFile(
    path.join(root, ".changeset/config.json"),
    JSON.stringify({
      baseBranch: "main",
      access: "public",
      changelog: false,
      privatePackages: { version: true, tag: false },
      snapshot: { useCalculatedVersion: true, prereleaseTemplate: "alpha-{commit}" },
    }),
  );
  for (const [directory, manifest] of Object.entries({
    cli: { name: "browse", version: "0.9.6", dependencies: { sdk: "workspace:*" } },
    sdk: { name: "sdk", version: "4.1.0" },
    python: { name: "python", version: "4.1.0", private: true },
  })) {
    await mkdir(path.join(root, "packages", directory), { recursive: true });
    await writeFile(
      path.join(root, "packages", directory, "package.json"),
      JSON.stringify(manifest, null, 2) + "\n",
    );
  }
  if (changes === "both" || changes === "cli")
    await writeFile(
      path.join(root, ".changeset/browse.md"),
      '---\n"browse": minor\n---\nCLI improvement\n',
    );
  if (changes === "both" || changes === "sdk")
    await writeFile(
      path.join(root, ".changeset/sdk.md"),
      '---\n"sdk": minor\n"python": patch\n---\nSDK improvement\n',
    );
  if (changes === "mixed")
    await writeFile(
      path.join(root, ".changeset/mixed.md"),
      '---\n"browse": minor\n"sdk": minor\n---\nMixed\n',
    );
  execFileSync("git", ["init", "-b", "main"], { cwd: root, stdio: "ignore" });
  execFileSync("git", ["add", "."], { cwd: root });
  execFileSync(
    "git",
    ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "Initial"],
    { cwd: root, stdio: "ignore" },
  );
  return root;
}

const manifest = async (root: string, name: string) =>
  JSON.parse(await readFile(path.join(root, "packages", name, "package.json"), "utf8"));

describe("independent release scopes using the real Changesets engine", () => {
  it("waits for an in-flight SDK publication without waiting on unrelated SDK jobs", async () => {
    const root = await fixture("cli");
    let requests = 0;
    let status = 404;
    const server = createServer((_request, response) => {
      requests++;
      response.writeHead(requests === 1 ? 404 : status).end("{}");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing HTTP server address");
    const registry = `http://127.0.0.1:${address.port}`;
    try {
      status = 200;
      await assertPublishedCliDependencies(root, registry, 1000, 10);
      expect(requests).toBe(2);
      status = 404;
      await expect(assertPublishedCliDependencies(root, registry, 20)).rejects.toThrow();
      status = 503;
      const before = requests;
      await expect(assertPublishedCliDependencies(root, registry, 1000)).rejects.toThrow(
        "registry status 503",
      );
      expect(requests).toBe(before + 1);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it("aborts a stalled registry request within the dependency-wait deadline", async () => {
    const root = await fixture("cli");
    let requests = 0;
    const server = createServer(() => {
      requests++;
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing HTTP server address");
    try {
      await expect(
        assertPublishedCliDependencies(root, `http://127.0.0.1:${address.port}`, 500),
      ).rejects.toMatchObject({ name: "TimeoutError" });
      expect(requests).toBe(1);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it("checks the CLI version before rebuilding and distinguishes missing versions from registry failures", async () => {
    const root = await fixture();
    let status = 404;
    const requests: string[] = [];
    const server = createServer((request, response) => {
      requests.push(request.url ?? "");
      response.writeHead(status).end("{}");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing HTTP server address");
    const registry = `http://127.0.0.1:${address.port}`;
    try {
      expect(await isCliVersionPublished(root, registry)).toBe(false);
      await expect(assertPublishedCliDependencies(root, registry)).rejects.toThrow(
        "Publish sdk@4.1.0 before Browse",
      );
      status = 200;
      expect(await isCliVersionPublished(root, registry)).toBe(true);
      await assertPublishedCliDependencies(root, registry);
      status = 503;
      await expect(isCliVersionPublished(root, registry)).rejects.toThrow("Registry returned 503");
      expect(requests).toContain("/browse/0.9.6");
      expect(requests).toContain("/sdk/4.1.0");
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  for (const first of ["cli", "sdk"] as const) {
    it(`versions ${first} first without consuming or changing the other release`, async () => {
      const root = await fixture();
      const other = first === "cli" ? "sdk" : "cli";
      const untouchedNote = path.join(root, `.changeset/${other === "cli" ? "browse" : "sdk"}.md`);
      const before = await readFile(untouchedNote, "utf8");
      const otherManifest = await manifest(root, other);
      await versionScope(root, first);
      expect(await manifest(root, other)).toEqual(otherManifest);
      expect(await readFile(untouchedNote, "utf8")).toBe(before);
      expect(await scopedChangesets(root, first)).toHaveLength(0);
      expect(await scopedChangesets(root, other)).toHaveLength(1);
      await versionScope(root, other);
      expect((await manifest(root, "cli")).version).toBe("0.10.0");
      expect((await manifest(root, "sdk")).version).toBe("4.2.0");
      expect((await manifest(root, "python")).version).toBe("4.1.1");
      expect((await manifest(root, "cli")).dependencies.sdk).toBe("workspace:*");
      expect((await versionScope(root, first)).releases).toHaveLength(0);
    });
  }

  it("keeps Browse out of SDK alpha versions and leaves its note intact", async () => {
    const root = await fixture();
    await versionScope(root, "sdk", true);
    expect((await manifest(root, "sdk")).version).toMatch(/^4\.2\.0-alpha-[a-f0-9]+$/);
    expect((await manifest(root, "cli")).version).toBe("0.9.6");
    expect(await scopedChangesets(root, "cli")).toHaveLength(1);
    expect(await scopedChangesets(root, "sdk")).toHaveLength(0);
  });

  it("rejects mixed changesets before mutating either package", async () => {
    const root = await fixture("mixed");
    await expect(versionScope(root, "cli")).rejects.toThrow("Split mixed CLI/SDK changeset");
    expect(execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" })).toBe(
      "",
    );
  });

  it("rejects shared prerelease state before versioning", async () => {
    const root = await fixture();
    await writeFile(path.join(root, ".changeset/pre.json"), "{}");
    await expect(versionScope(root, "cli")).rejects.toThrow("Exit Changesets prerelease mode");
  });

  for (const scope of ["cli", "sdk"] as const) {
    for (const fail of [false, true]) {
      it(`exposes only ${scope} to the native publisher and restores manifests after ${fail ? "failure" : "success"}`, async () => {
        const root = await fixture();
        const original = await Promise.all(
          ["cli", "sdk", "python"].map((name) =>
            readFile(path.join(root, "packages", name, "package.json"), "utf8"),
          ),
        );
        const publish = withPublishScope(root, scope, async () => {
          expect(Boolean((await manifest(root, "cli")).private)).toBe(scope !== "cli");
          expect(Boolean((await manifest(root, "sdk")).private)).toBe(scope !== "sdk");
          expect((await manifest(root, "python")).private).toBe(true);
          if (fail) throw new Error("publish failed");
        });
        if (fail) await expect(publish).rejects.toThrow("publish failed");
        else await publish;
        const restored = await Promise.all(
          ["cli", "sdk", "python"].map((name) =>
            readFile(path.join(root, "packages", name, "package.json"), "utf8"),
          ),
        );
        expect(restored).toEqual(original);
      });
    }
  }

  it("lets the SDK action publish while Browse is pending, then restores the exact file", async () => {
    const root = await fixture("cli");
    const before = await readFile(path.join(root, ".changeset/browse.md"), "utf8");
    const script = path.resolve(import.meta.dirname, "sdk-action-changesets.ts");
    const tsx = path.resolve("node_modules/tsx/dist/cli.mjs");
    const output = execFileSync(process.execPath, [tsx, script, "hide"], {
      cwd: root,
      encoding: "utf8",
    });
    const backup = output.trim().split("=")[1];
    directories.push(backup);
    expect(await readdir(path.join(root, ".changeset"))).toEqual(["config.json"]);
    execFileSync(process.execPath, [tsx, script, "restore", backup], { cwd: root });
    expect(await readFile(path.join(root, ".changeset/browse.md"), "utf8")).toBe(before);
    expect(execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" })).toBe(
      "",
    );
  });
});
