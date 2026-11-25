import { describe, it } from "vitest";

export const itPosix = it.runIf(process.platform !== "win32");
export const describePosix = describe.runIf(process.platform !== "win32");
