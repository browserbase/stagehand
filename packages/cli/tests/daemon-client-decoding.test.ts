import { promises as fs } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, expect, vi } from "vitest";
import { it } from "vitest";
import { describePosix } from "./helpers/platform.js";
import { runDriverCommandViaDaemon } from "../src/lib/driver/daemon/client.js";
import { getSocketPath } from "../src/lib/driver/daemon/paths.js";

// A real socket is needed: the bug only shows when the kernel delivers one
// reply in several chunks and a chunk boundary lands inside a character.
describePosix("daemon client reply decoding", () => {
  const session = "default";
  let fixtureDir: string;
  let server: net.Server;
  let reply: Buffer;
  let splitAt: number;

  beforeEach(async () => {
    fixtureDir = await fs.realpath(await fs.mkdtemp(join(tmpdir(), "browse-utf8-")));
    vi.stubEnv("BROWSE_DAEMON_DIR", fixtureDir);
    server = net.createServer((socket) => {
      socket.once("data", (chunk) => {
        const request = JSON.parse(chunk.toString().split("\n")[0] ?? "{}");
        reply = Buffer.from(
          `${JSON.stringify({ type: "success", id: request.id, data: { text: "日本語 ✓" } })}\n`,
        );
        splitAt = reply.indexOf(Buffer.from("日")) + 1;
        socket.setNoDelay(true);
        socket.write(reply.subarray(0, splitAt));
        setTimeout(() => socket.end(reply.subarray(splitAt)), 50);
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(getSocketPath(session), resolve);
    });
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    vi.unstubAllEnvs();
    await fs.rm(fixtureDir, { recursive: true, force: true });
  });

  it("keeps multi-byte characters split across socket chunks intact", async () => {
    await expect(runDriverCommandViaDaemon(session, "snapshot")).resolves.toEqual({
      text: "日本語 ✓",
    });
  });
});
