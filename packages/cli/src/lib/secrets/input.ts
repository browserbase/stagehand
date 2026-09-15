import password from "@inquirer/password";
import { fail } from "../errors.js";

export async function readSecretValue(options: {
  stdin?: boolean;
}): Promise<Uint8Array> {
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
    fail("Use --stdin to read a secret value from piped input.");
  try {
    return Buffer.from(
      await password({ message: "Secret value:" }, { output: process.stderr }),
      "utf8",
    );
  } catch {
    fail("Secret input cancelled.");
  }
}
