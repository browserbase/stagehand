import { ndJsonStream, type Stream } from "@agentclientprotocol/sdk";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { Readable, Writable } from "node:stream";

export type AcpAgentProcess = {
  readonly transport: Stream;
  readonly started: Promise<void>;
  signal(signal: "SIGTERM" | "SIGKILL"): Promise<void>;
  terminate(graceMs: number): Promise<void>;
};

export function spawnAcpAgentProcess(options: {
  command: string;
  args: readonly string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  stderr: NodeJS.WritableStream;
}): AcpAgentProcess {
  const child = spawn(options.command, [...options.args], {
    cwd: options.cwd,
    detached: process.platform !== "win32",
    env: definedEnvironment(options.env),
    stdio: ["pipe", "pipe", "pipe"],
  });
  const started = new Promise<void>((resolve, reject) => {
    child.once("spawn", resolve);
    child.on("error", reject);
  });
  child.stderr.pipe(options.stderr, { end: false });

  let closed = false;
  const closePromise = new Promise<void>((resolve) => {
    child.once("close", () => {
      closed = true;
      resolve();
    });
  });

  return {
    started,
    transport: ndJsonStream(
      Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
      Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
    ),
    signal: (signal) => signalProcessTree(child, signal),
    terminate: async (graceMs) => {
      try {
        if (closed) return;
        await signalProcessTree(child, "SIGTERM");
        if (await closesWithin(closePromise, graceMs)) return;
        await signalProcessTree(child, "SIGKILL");
        if (await closesWithin(closePromise, graceMs)) return;
        child.stdin.destroy();
        child.stdout.destroy();
        child.stderr.destroy();
      } finally {
        child.stderr.unpipe(options.stderr);
      }
    },
  };
}

function definedEnvironment(source: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(
    Object.entries(source).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
}

async function closesWithin(closed: Promise<void>, graceMs: number): Promise<boolean> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      closed.then(() => true),
      new Promise<false>((resolve) => {
        timeout = setTimeout(() => resolve(false), graceMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function signalProcessTree(
  child: ChildProcessWithoutNullStreams,
  signal: "SIGTERM" | "SIGKILL",
): Promise<void> {
  if (process.platform !== "win32" && child.pid !== undefined) {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") return;
      child.kill(signal);
      return;
    }
  }

  if (process.platform === "win32" && child.pid !== undefined) {
    await new Promise<void>((resolve) => {
      const args = ["/PID", String(child.pid), "/T", ...(signal === "SIGKILL" ? ["/F"] : [])];
      const terminator = spawn("taskkill", args, { stdio: "ignore" });
      terminator.once("error", () => {
        child.kill(signal);
        resolve();
      });
      terminator.once("close", () => resolve());
    });
    return;
  }

  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill(signal);
}
