import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import config from "../../oxlint.config.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));

it("rejects Node globals in browser production code while allowing local names and tooling", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "stagehand-browser-lint-"));
  try {
    await writeFile(
      path.join(directory, ".oxlintrc.json"),
      JSON.stringify({
        ...config,
        options: { ...config.options, typeAware: false },
        jsPlugins: [
          { name: "stagehand", specifier: path.join(root, "rules/oxlint/stagehand-plugin.ts") },
        ],
      }),
    );
    const rejected = [
      ['process.emitWarning("warning");', "process"],
      ['Buffer.from("hello");', "Buffer"],
      [
        "const globals = { process, Buffer, __dirname, __filename };",
        "process",
        "Buffer",
        "__dirname",
        "__filename",
      ],
      ['globalThis.Buffer.from("hello");', "Buffer"],
      ['globalThis["Buffer"].from("hello");', "Buffer"],
      ["const { Buffer } = globalThis;", "Buffer"],
      [
        'const { Buffer: Encoder, ["process"]: proc, "require": load } = globalThis;',
        "Buffer",
        "process",
        "require",
      ],
      ["let Encoder; ({ Buffer: Encoder } = globalThis);", "Buffer"],
      ["function example({ Buffer } = globalThis) {}", "Buffer"],
      ['module.exports = require("node:fs"); exports.value = 1;', "module", "require", "exports"],
      ["let timeout: NodeJS.Timeout;", "NodeJS"],
      ["global.process;", "global"],
      ["clearImmediate(setImmediate(() => {}));", "clearImmediate", "setImmediate"],
    ];
    const allowed = `
      const model = { process: () => {}, Buffer: 1 };
      model.process(); model["Buffer"];
      const { Buffer: modelBuffer } = model;
      const Buffer = "local";
      const values = { Buffer };
      function example(process: string, globalThis: { Buffer: number }) {
        const { Buffer: Encoder } = globalThis;
        let assigned;
        ({ Buffer: assigned } = globalThis);
        return [process, globalThis.Buffer, globalThis["Buffer"], Encoder, assigned];
      }
      function localModules(require: (id: string) => object, module: { exports: object }, exports: object) {
        module.exports = require("local");
        return exports;
      }
      namespace NodeJS { export type Timeout = number; }
      let timeout: NodeJS.Timeout;
      function localTimers(global: object, setImmediate: () => number, clearImmediate: (id: number) => void) {
        clearImmediate(setImmediate());
        return global;
      }
    `;
    const fixtures: Record<string, string> = {};
    for (const base of ["packages/extension", "packages/shared-object-model/src"]) {
      rejected.forEach(([source], index) => {
        fixtures[`${base}/rejected-${index}.ts`] = source;
      });
      fixtures[`${base}/allowed.ts`] = allowed;
    }
    for (const file of [
      "packages/sdk-ts/src/example.ts",
      "packages/extension/vite.config.ts",
      "packages/extension/instrumentedDecoratorBuild.ts",
      "packages/extension/tests/helpers/example.ts",
      "packages/extension/example.test.ts",
      "packages/shared-object-model/tests/example.ts",
      "packages/shared-object-model/src/example.spec.ts",
    ])
      fixtures[file] = 'Buffer.from("allowed"); process.pid;';
    for (const [file, source] of Object.entries(fixtures)) {
      await mkdir(path.dirname(path.join(directory, file)), { recursive: true });
      await writeFile(path.join(directory, file), source);
    }
    const result = spawnSync(
      process.execPath,
      [path.join(root, "node_modules/oxlint/bin/oxlint"), "--format", "json", "."],
      {
        cwd: directory,
        encoding: "utf8",
        timeout: 10_000,
      },
    );
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(1);
    const diagnostics = (
      JSON.parse(result.stdout).diagnostics as Array<{
        filename: string;
        code: string;
        message: string;
      }>
    ).filter((entry) => entry.code === "stagehand(no-node-globals)");
    const expected = ["packages/extension", "packages/shared-object-model/src"].flatMap((base) =>
      rejected.flatMap(([, ...names], index) =>
        names.map((name) => ({
          filename: `${base}/rejected-${index}.ts`,
          message: `Browser production code must not use Node global ${name}.`,
        })),
      ),
    );
    expect(diagnostics.map(({ filename, message }) => ({ filename, message }))).toEqual(
      expect.arrayContaining(expected),
    );
    expect(diagnostics).toHaveLength(expected.length);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
