import password from "@inquirer/password";
import { fail } from "../errors.js";

export async function readSecretValue(options: {
  stdin?: boolean;
  env?: string;
}): Promise<Uint8Array> {
  if (options.env !== undefined) {
    if (options.stdin) fail("--env and --stdin cannot be used together.");
    if (!options.env) fail("--env requires an environment variable name.");
    const value = process.env[options.env];
    if (value === undefined)
      fail("The environment variable selected by --env is not set.");
    return Buffer.from(value, "utf8");
  }
  if (options.stdin) {
    if (process.stdin.isTTY)
      fail("--stdin requires piped input or file redirection.");
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }
  if (!process.stdin.isTTY)
    fail(
      "Use --stdin for piped input or --env to read an environment variable.",
    );
  try {
    return Buffer.from(
      await password({ message: "Secret value:" }, { output: process.stderr }),
      "utf8",
    );
  } catch {
    fail("Secret input cancelled.");
  }
}
