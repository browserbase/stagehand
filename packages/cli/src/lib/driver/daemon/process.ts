import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

// null means the process is alive, but its identity could not be established.
// Callers must not kill it or remove its session files in that case.
export function isDaemonProcess(pid: number, session: string): boolean | null {
  if (!Number.isSafeInteger(pid) || pid <= 0 || !isProcessAlive(pid)) return false;
  const identity = inspectDaemonProcess(pid, session);
  return identity === null && !isProcessAlive(pid) ? false : identity;
}

function inspectDaemonProcess(pid: number, session: string): boolean | null {
  const entrypoint = process.argv[1];
  if (!entrypoint) return null;

  if (process.platform === "linux") {
    try {
      const argv = readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0");
      if (argv.at(-1) === "") argv.pop();
      if (argv.length === 0 || (argv.length === 1 && argv[0] === "")) return null;
      if (argv[2] !== "daemon" || argv[3] !== "--session" || argv[4] !== session) {
        return false;
      }
      // A different installation may own the session. Leave its files intact.
      if (argv[0] !== process.execPath || argv[1] !== entrypoint) return null;
      return argv.length === 7 && argv[5] === "--target" ? true : null;
    } catch {
      return null;
    }
  }

  const prefix = [process.execPath, entrypoint, "daemon", "--session", session, "--target"];
  if (process.platform === "win32") {
    const cmdline = getWindowsProcessCommandLine(pid);
    const expected = `${prefix.map(quoteWindowsArgument).join(" ")} `;
    return cmdline?.startsWith(expected) && cmdline.length > expected.length ? true : null;
  }

  const cmdline = getPosixProcessCommandLine(pid);
  const expected = `${prefix.join(" ")} `;
  if (!cmdline?.startsWith(expected)) return null;
  // ps joins argv with spaces, so a session containing " --target " is ambiguous
  // unless the remaining argument is the JSON target emitted by spawnDaemon.
  try {
    const target: unknown = JSON.parse(cmdline.slice(expected.length));
    return target !== null && typeof target === "object" && !Array.isArray(target) ? true : null;
  } catch {
    return null;
  }
}

// Match Node's Windows argument quoting, including quotes and trailing slashes.
function quoteWindowsArgument(argument: string): string {
  if (argument && !/[ \t"]/.test(argument)) return argument;
  return `"${argument.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, "$1$1")}"`;
}

function getPosixProcessCommandLine(pid: number): string | null {
  try {
    const result = execFileSync("ps", ["-ww", "-p", String(pid), "-o", "command="], {
      encoding: "utf8",
      timeout: 2000,
    });
    return result.trim();
  } catch {
    return null;
  }
}

function getWindowsProcessCommandLine(pid: number): string | null {
  const powershell = tryPowerShellCommandLine(pid);
  if (powershell !== null) return powershell;
  return tryWmicCommandLine(pid);
}

function tryPowerShellCommandLine(pid: number): string | null {
  try {
    const result = execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`,
      ],
      { encoding: "utf8", timeout: 5000, windowsHide: true },
    );
    const trimmed = result.trim();
    return trimmed || null;
  } catch {
    return null;
  }
}

function tryWmicCommandLine(pid: number): string | null {
  try {
    const result = execFileSync(
      "wmic",
      ["process", "where", `ProcessId=${pid}`, "get", "CommandLine", "/format:list"],
      { encoding: "utf8", timeout: 2000, windowsHide: true },
    );
    const match = result.match(/CommandLine=(.+)/);
    return match?.[1]?.trim() ?? null;
  } catch {
    return null;
  }
}

export function killProcess(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, "SIGKILL");
    return true;
  } catch {
    return false;
  }
}
