import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const packageName = "@browserbasehq/stagehand-v4-spike-sdk-ts";
const detectVariant = `
  const sdk = await import(${JSON.stringify(packageName)});
  try {
    new sdk.Stagehand({ browser: { type: "local" } });
    process.stdout.write("node");
  } catch {
    process.stdout.write("web");
  }
`;

for (const [condition, expectedVariant] of [
  [undefined, "node"],
  ["workerd", "web"],
  ["deno", "web"],
  ["bun", "web"],
  ["browser", "web"],
]) {
  const arguments_ = [
    ...(condition === undefined ? [] : [`--conditions=${condition}`]),
    "--input-type=module",
    "--eval",
    detectVariant,
  ];
  const { stdout } = await execFileAsync(process.execPath, arguments_, {
    cwd: new URL("..", import.meta.url),
  });
  if (stdout !== expectedVariant) {
    throw new Error(
      `Expected ${condition ?? "default Node"} to resolve ${expectedVariant}, received ${stdout}`,
    );
  }
}
