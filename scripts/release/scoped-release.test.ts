import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { scopedChangesets } from "./release-scope.ts";
import { versionScope, withPublishScope } from "./scoped-release.ts";

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
