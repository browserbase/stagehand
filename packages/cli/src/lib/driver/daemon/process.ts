import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

export function isDaemonProcess(pid: number, session: string): boolean {
  if (!isProcessAlive(pid)) return false;
  // On Windows, skip identity check - process.kill still verifies the PID exists
  if (process.platform === "win32") return true;
  try {
    const cmdline = getProcessCommandLine(pid);
    if (cmdline === null) return false;
    return cmdline.includes("daemon") && cmdline.includes(`--session ${session}`);
  } catch {
    return false;
  }
}

function getProcessCommandLine(pid: number): string | null {
  if (process.platform === "linux") {
    try {
      const raw = readFileSync(`/proc/${pid}/cmdline`, "utf8");
      return raw.split(String.fromCharCode(0)).join(" ").trim() || null;
    } catch {
      return null;
    }
  }
  // macOS/BSD
  try {
    return (
      execFileSync("ps", ["-p", String(pid), "-o", "command="], {
        encoding: "utf8",
        timeout: 2000,
      }).trim() || null
    );
  } catch {
    return null;
  }
}

export function killProcess(pid: number): boolean {
  try {
    process.kill(pid, "SIGKILL");
    return true;
  } catch {
    return false;
  }
}
