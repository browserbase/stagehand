export function buildAcpFacadeEnv(source: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (/^(STAGEHAND_|BROWSERBASE_)/u.test(key) && value) env[key] = value;
  }
  return env;
}

const RUNTIME_ENV_KEYS = [
  "PATH",
  "HOME",
  "TMPDIR",
  "TMP",
  "TEMP",
  "USERPROFILE",
  "HOMEDRIVE",
  "HOMEPATH",
  "LOCALAPPDATA",
  "PROGRAMFILES",
  "PROGRAMFILES(X86)",
  "ProgramW6432",
  "SYSTEMROOT",
  "SystemRoot",
  "WINDIR",
] as const;

export function buildAcpFacadeRuntimeEnv(
  source: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const env = buildAcpFacadeEnv(source);
  for (const key of RUNTIME_ENV_KEYS) {
    const value = source[key];
    if (value) env[key] = value;
  }
  return env;
}
