import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export async function isolatedCodexEnv(
  cwd: string,
  source: NodeJS.ProcessEnv = process.env,
): Promise<Record<string, string>> {
  const home = path.join(cwd, "home");
  const codexHome = path.join(home, ".codex");
  await fs.mkdir(codexHome, { recursive: true, mode: 0o700 });
  const originalHome = source.CODEX_HOME ?? path.join(source.HOME ?? os.homedir(), ".codex");
  if (!source.OPENAI_API_KEY && !source.CODEX_API_KEY) {
    try {
      const auth = await fs.readFile(path.join(originalHome, "auth.json"));
      await fs.writeFile(path.join(codexHome, "auth.json"), auth, { mode: 0o600 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  const env = Object.fromEntries(
    Object.entries(source).filter(
      ([key, value]) =>
        value !== undefined && (!key.startsWith("CODEX_") || key === "CODEX_API_KEY"),
    ),
  ) as Record<string, string>;
  return { ...env, HOME: home, CODEX_HOME: codexHome };
}
