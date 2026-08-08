import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdir, mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const repositoryRoot = path.resolve(packageRoot, "../..");
const sdkRoot = path.join(repositoryRoot, "packages", "sdk-ts");
const temporaryRoot = await mkdtemp(path.join(tmpdir(), "stagehand-codemode-package-"));
const artifactRoot = path.join(temporaryRoot, "artifacts");
const installRoot = path.join(temporaryRoot, "install");

try {
  await Promise.all([
    mkdir(artifactRoot, { recursive: true }),
    mkdir(installRoot, { recursive: true }),
  ]);
  await execFileAsync(
    "pnpm",
    ["exec", "turbo", "run", "build", "--filter", "@browserbasehq/stagehand-codemode"],
    { cwd: repositoryRoot },
  );
  await execFileAsync("pnpm", ["pack", "--pack-destination", artifactRoot], {
    cwd: sdkRoot,
  });
  await execFileAsync("pnpm", ["pack", "--pack-destination", artifactRoot], {
    cwd: packageRoot,
  });

  const artifacts = await readdir(artifactRoot);
  const sdkTarball = requiredArtifact(artifacts, "browserbasehq-stagehand-4.0.0.tgz");
  const codeModeTarball = requiredArtifact(artifacts, "browserbasehq-stagehand-codemode-4.0.0.tgz");
  const codeModeTarballPath = path.join(artifactRoot, codeModeTarball);
  const { stdout: tarList } = await execFileAsync("tar", ["-tzf", codeModeTarballPath]);
  const files = tarList.trim().split("\n").sort();
  for (const expected of [
    "package/LICENSE",
    "package/README.md",
    "package/codemode/REFERENCE.md",
    "package/codemode/SKILL.md",
    "package/dist/codemode/stdio-server.mjs",
    "package/package.json",
  ]) {
    assert.ok(files.includes(expected), `packed artifact is missing ${expected}`);
  }
  assert.equal(
    files.some((file) => /package\/(?:src|tests|examples)\//.test(file)),
    false,
    "packed artifact includes repository-only source or test files",
  );
  const { stdout: verboseTarList } = await execFileAsync("tar", ["-tvzf", codeModeTarballPath]);
  assert.match(
    verboseTarList,
    /^-rwxr-xr-x\s+[^\n]*package\/dist\/codemode\/stdio-server\.mjs$/m,
    "packed stagehand-codemode executable is not mode 755",
  );

  await execFileAsync(
    "npm",
    [
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      path.join(artifactRoot, sdkTarball),
      codeModeTarballPath,
    ],
    { cwd: installRoot },
  );

  const installedPackageRoot = path.join(
    installRoot,
    "node_modules",
    "@browserbasehq",
    "stagehand-codemode",
  );
  const manifest = JSON.parse(
    await readFile(path.join(installedPackageRoot, "package.json"), "utf8"),
  );
  assert.equal(manifest.name, "@browserbasehq/stagehand-codemode");
  assert.equal(manifest.dependencies?.["@browserbasehq/stagehand"], "4.0.0");
  assert.deepEqual(manifest.bin, {
    "stagehand-codemode": "dist/codemode/stdio-server.mjs",
  });

  const executable = path.join(installRoot, "node_modules", ".bin", "stagehand-codemode");
  await access(executable, constants.X_OK);
  await verifyDiscoveryAndEof(executable);
  await verifySignals(executable);
  const localBrowser = process.env.CHROME_PATH
    ? await verifyLocalBrowserAndHardTimeout(executable)
    : "SKIPPED";
  const browserbase = process.env.BROWSERBASE_API_KEY
    ? await verifyBrowserbasePersistence(executable)
    : "SKIPPED";

  process.stdout.write(
    `${JSON.stringify({
      status: "PASS",
      package: manifest.name,
      version: manifest.version,
      stagehandDependency: manifest.dependencies["@browserbasehq/stagehand"],
      executable: "stagehand-codemode",
      tools: ["code_execute"],
      eof: "PASS",
      signals: ["SIGINT", "SIGTERM"],
      localBrowser,
      hardTimeout: localBrowser === "PASS" ? "PASS" : "SKIPPED",
      browserbase,
      tarballBytes: (await stat(codeModeTarballPath)).size,
      files: files.length,
    })}\n`,
  );
} finally {
  await rm(temporaryRoot, { force: true, recursive: true });
}

function requiredArtifact(artifacts, suffix) {
  const matches = artifacts.filter((artifact) => artifact.endsWith(suffix));
  assert.equal(matches.length, 1, `expected one artifact ending in ${suffix}`);
  return matches[0];
}

async function verifyDiscoveryAndEof(executable) {
  const { rpc, server } = await initializedServer(executable, "local");
  try {
    const listed = await rpc.request("tools/list", {});
    assert.deepEqual(
      listed.tools?.map((tool) => tool.name),
      ["code_execute"],
    );
    server.stdin.end();
    assert.deepEqual(await waitForExit(server), { code: 0, signal: null });
  } finally {
    if (server.exitCode === null && server.signalCode === null) server.kill("SIGKILL");
  }
}

async function verifySignals(executable) {
  for (const [signal, expectedCode] of [
    ["SIGINT", 130],
    ["SIGTERM", 143],
  ]) {
    const { server } = await initializedServer(executable, "local");
    try {
      server.kill(signal);
      assert.deepEqual(await waitForExit(server), { code: expectedCode, signal: null });
    } finally {
      if (server.exitCode === null && server.signalCode === null) server.kill("SIGKILL");
    }
  }
}

async function verifyLocalBrowserAndHardTimeout(executable) {
  const { rpc, server } = await initializedServer(executable, "local");
  try {
    const result = await rpc.request("tools/call", {
      name: "code_execute",
      arguments: {
        code: `
          await page.goto("https://example.com", { waitUntil: "domcontentloaded" });
          return { title: await page.title(), url: await page.url() };
        `,
      },
    });
    assert.equal(result.isError ?? false, false);
    assert.deepEqual(result.structuredContent?.value, {
      title: "Example Domain",
      url: "https://example.com/",
    });
    server.stdin.end();
    assert.deepEqual(await waitForExit(server), { code: 0, signal: null });
  } finally {
    if (server.exitCode === null && server.signalCode === null) server.kill("SIGKILL");
  }

  const blocked = await initializedServer(executable, "local", true);
  try {
    const initialized = await blocked.rpc.request("tools/call", {
      name: "code_execute",
      arguments: { code: "return { ready: true };" },
    });
    assert.equal(initialized.structuredContent?.value?.ready, true);
    const neverFinishes = blocked.rpc
      .request("tools/call", {
        name: "code_execute",
        arguments: { code: "while (true) {}" },
      })
      .then(
        () => "resolved",
        () => "rejected",
      );
    assert.equal(await Promise.race([neverFinishes, delay(500).then(() => "blocked")]), "blocked");
    killProcessGroup(blocked.server, "SIGKILL");
    assert.deepEqual(await waitForExit(blocked.server), { code: null, signal: "SIGKILL" });
    assert.equal(await neverFinishes, "rejected");
  } finally {
    if (blocked.server.exitCode === null && blocked.server.signalCode === null) {
      killProcessGroup(blocked.server, "SIGKILL");
    }
  }
  return "PASS";
}

async function verifyBrowserbasePersistence(executable) {
  const marker = `package-${Date.now()}`;
  const { rpc, server } = await initializedServer(executable, "browserbase");
  try {
    const first = await rpc.request("tools/call", {
      name: "code_execute",
      arguments: {
        code: `
          await page.goto("https://example.com", { waitUntil: "domcontentloaded" });
          await page.evaluate((marker) => {
            document.documentElement.dataset.packageSmoke = marker;
          }, ${JSON.stringify(marker)});
          return { title: await page.title(), pageId: page.pageId };
        `,
      },
    });
    const second = await rpc.request("tools/call", {
      name: "code_execute",
      arguments: {
        code: `
          return {
            title: await page.title(),
            pageId: page.pageId,
            marker: await page.evaluate(
              () => document.documentElement.dataset.packageSmoke,
            ),
          };
        `,
      },
    });
    assert.equal(first.isError ?? false, false);
    assert.equal(second.isError ?? false, false);
    assert.equal(first.structuredContent?.value?.title, "Example Domain");
    assert.equal(second.structuredContent?.value?.title, "Example Domain");
    assert.equal(second.structuredContent?.value?.pageId, first.structuredContent?.value?.pageId);
    assert.equal(second.structuredContent?.value?.marker, marker);
    server.stdin.end();
    assert.deepEqual(await waitForExit(server), { code: 0, signal: null });
  } finally {
    if (server.exitCode === null && server.signalCode === null) server.kill("SIGKILL");
  }
  return "PASS";
}

async function initializedServer(executable, browser, detached = false) {
  const server = spawn(executable, [], {
    cwd: installRoot,
    detached,
    env: runtimeEnvironment(browser),
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stderr = "";
  server.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  try {
    const rpc = jsonRpcClient(server);
    const initialized = await rpc.request("initialize", {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "stagehand-codemode-package-smoke", version: "1.0.0" },
    });
    assert.equal(initialized.serverInfo?.name, "stagehand-codemode");
    rpc.notify("notifications/initialized", {});
    return { rpc, server };
  } catch (error) {
    if (server.exitCode === null && server.signalCode === null) server.kill("SIGKILL");
    throw new Error(`Installed stagehand-codemode failed to initialize: ${stderr}`, {
      cause: error,
    });
  }
}

function runtimeEnvironment(browser) {
  const environment = {
    PATH: process.env.PATH ?? "",
    STAGEHAND_BROWSER: browser,
  };
  const names = ["CHROME_PATH", "CI", "HOME", "TMPDIR"];
  if (browser === "browserbase") {
    names.push("BROWSERBASE_API_KEY", "BROWSERBASE_PROJECT_ID");
  }
  for (const name of names) {
    const value = process.env[name];
    if (value) environment[name] = value;
  }
  return environment;
}

function jsonRpcClient(child) {
  let nextId = 1;
  let buffered = "";
  const pending = new Map();
  child.stdout.on("data", (chunk) => {
    buffered += chunk.toString();
    while (buffered.includes("\n")) {
      const newline = buffered.indexOf("\n");
      const line = buffered.slice(0, newline);
      buffered = buffered.slice(newline + 1);
      if (!line) continue;
      const message = JSON.parse(line);
      if (message.id === undefined) continue;
      const waiter = pending.get(message.id);
      if (!waiter) continue;
      pending.delete(message.id);
      if (message.error) waiter.reject(new Error(`MCP error ${message.error.code}`));
      else waiter.resolve(message.result);
    }
  });
  child.once("close", () => {
    for (const waiter of pending.values()) waiter.reject(new Error("MCP process closed"));
    pending.clear();
  });

  const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`);
  return {
    notify(method, params) {
      send({ jsonrpc: "2.0", method, params });
    },
    request(method, params) {
      const id = nextId++;
      const response = new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
      send({ jsonrpc: "2.0", id, method, params });
      return withTimeout(response, `Timed out waiting for MCP ${method}`);
    },
  };
}

function killProcessGroup(child, signal) {
  assert.ok(child.pid, "detached MCP server has no process ID");
  process.kill(-child.pid, signal);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function waitForExit(child) {
  return withTimeout(
    new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) => resolve({ code, signal }));
    }),
    "Installed stagehand-codemode did not exit",
  );
}

function withTimeout(promise, message) {
  let timeout;
  const deadline = new Promise((_, reject) => {
    timeout = setTimeout(() => reject(new Error(message)), 15_000);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timeout));
}
