import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const { exec } = vi.hoisted(() => ({ exec: vi.fn() }));
vi.mock("node:child_process", () => ({ execFile: exec }));

import {
  installMcpRuntime,
  mcpEntrypoint,
  mcpRuntimeDir,
} from "../src/lib/mcp/install.js";
import { isCompatible } from "../src/lib/mcp/contract.js";

let env: NodeJS.ProcessEnv;
let root: string;

function npmInstalls(version: string, sdkVersion = "4.3.0") {
  exec.mockImplementation((_, args: string[], __, callback) => {
    const modules = join(args[args.indexOf("--prefix") + 1]!, "node_modules");
    void (async () => {
      await mkdir(join(modules, "stagehand-middleware"), { recursive: true });
      await mkdir(join(modules, "@browserbasehq", "stagehand"), {
        recursive: true,
      });
      await writeFile(
        join(modules, "stagehand-middleware", "package.json"),
        JSON.stringify({
          name: "stagehand-middleware",
          version,
          peerDependencies: { "@browserbasehq/stagehand": ">=4.3.0 <5" },
        }),
      );
      await writeFile(
        join(modules, "@browserbasehq", "stagehand", "package.json"),
        JSON.stringify({
          name: "@browserbasehq/stagehand",
          version: sdkVersion,
        }),
      );
    })().then(() => callback(null, "", ""), callback);
  });
}

async function current(): Promise<{ id: string; version: string }> {
  const { version: id } = JSON.parse(
    await readFile(join(root, "current.json"), "utf8"),
  );
  const { version } = JSON.parse(
    await readFile(join(root, "versions", id, "package.json"), "utf8"),
  );
  return { id, version };
}

const install = () => installMcpRuntime(process.version, env);

beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), "browse-mcp-install-"));
  env = { ...process.env, XDG_DATA_HOME: dir };
  root = mcpRuntimeDir(env);
  exec.mockReset();
});

afterEach(async () => {
  await rm(env.XDG_DATA_HOME!, { recursive: true, force: true });
});

it("installs the runtime without lifecycle scripts and lets npm add the SDK peer", async () => {
  npmInstalls("0.1.1");
  expect(await install()).toEqual({
    entrypoint: mcpEntrypoint(env),
    version: "0.1.1",
  });
  const args = exec.mock.calls[0]?.[1] as string[];
  expect(args).toEqual(
    expect.arrayContaining([
      "stagehand-middleware@^0.1.1",
      "@modelcontextprotocol/sdk@^1.32.2",
      "--ignore-scripts",
    ]),
  );
  expect(args).not.toContain("--legacy-peer-deps");
  expect(await readFile(mcpEntrypoint(env), "utf8")).toContain("current.json");
  const { id, version } = await current();
  expect(version).toBe("0.1.1");
  expect(await readdir(join(root, "versions", id))).toEqual(
    expect.arrayContaining(["main.js", "server.js", "node_modules"]),
  );
});

it("switches the stable launcher to each new version, keeping only the one it replaced", async () => {
  npmInstalls("0.1.1");
  await install();
  const first = await current();
  npmInstalls("0.1.2");
  await install();
  const second = await current();
  expect(second.version).toBe("0.1.2");
  // An agent started before the update may still be running the old version.
  expect((await readdir(join(root, "versions"))).sort()).toEqual(
    [first.id, second.id].sort(),
  );
  npmInstalls("0.1.3");
  await install();
  const third = await current();
  expect((await readdir(join(root, "versions"))).sort()).toEqual(
    [second.id, third.id].sort(),
  );
  expect((await readdir(root)).sort()).toEqual([
    "current.json",
    "main.mjs",
    "versions",
  ]);
});

it("leaves the launcher on the working version when npm fails, and reports npm's error", async () => {
  npmInstalls("0.1.1");
  await install();
  const before = await current();
  exec.mockImplementation((_, __, ___, callback) =>
    callback(Object.assign(new Error("failed"), { stderr: "npm error E404" })),
  );
  await expect(install()).rejects.toThrow("npm error E404");
  expect(await current()).toEqual(before);
  expect(await readdir(join(root, "versions"))).toEqual([before.id]);
});

it("refuses a middleware release that does not support the installed SDK or Node", async () => {
  npmInstalls("0.1.1");
  await install();
  const before = await current();
  npmInstalls("0.1.2", "5.0.0");
  await expect(install()).rejects.toThrow("incompatible");
  npmInstalls("0.1.2");
  await expect(installMcpRuntime("v20.19.0", env)).rejects.toThrow(
    "Node v20.19.0",
  );
  expect(await current()).toEqual(before);
});

it("checks the middleware, SDK, and Node compatibility ranges", () => {
  const manifest = {
    name: "stagehand-middleware",
    version: "0.1.2",
    peerDependencies: { "@browserbasehq/stagehand": ">=4.3.0 <5" },
  };
  const node = "v22.18.0";
  expect(isCompatible(manifest, "4.3.0", node)).toBe(true);
  expect(isCompatible({ ...manifest, version: "0.2.0" }, "4.3.0", node)).toBe(
    false,
  );
  expect(
    isCompatible({ ...manifest, version: "0.1.3-beta.1" }, "4.3.0", node),
  ).toBe(false);
  expect(
    isCompatible({ ...manifest, peerDependencies: {} }, "4.3.0", node),
  ).toBe(false);
  expect(isCompatible(manifest, "5.0.0", node)).toBe(false);
  expect(isCompatible(manifest, "4.3.0", "v20.19.0")).toBe(false);
  expect(
    isCompatible({ ...manifest, engines: { node: ">=999" } }, "4.3.0", node),
  ).toBe(false);
});
