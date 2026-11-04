import { promises as fs } from "node:fs";
import path from "node:path";
import { vi } from "vitest";

/** Simulate owner changes in fresh directory metadata without changing the caller's UID. */
export function mockDirectoryOwner(dir: string, owner: (actualUid: number) => number) {
  const open = fs.open.bind(fs);
  return vi.spyOn(fs, "open").mockImplementation(async (file, flags, mode) => {
    const handle = await open(file, flags, mode);
    if (path.resolve(String(file)) === path.resolve(dir)) {
      const stat = handle.stat.bind(handle);
      vi.spyOn(handle, "stat").mockImplementation(async (options) => {
        const entry = await stat(options);
        const uid = owner(Number(entry.uid));
        return Object.assign(entry, { uid: typeof entry.uid === "bigint" ? BigInt(uid) : uid });
      });
    }
    return handle;
  });
}
