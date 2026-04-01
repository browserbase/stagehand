import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { resolveContextLabel } from "../src/resolve-context";

let tmpDir: string;
let contextsDir: string;
const originalEnv = process.env.BROWSERBASE_CONFIG_DIR;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "browse-ctx-test-"));
  contextsDir = path.join(tmpDir, "contexts");
  fs.mkdirSync(contextsDir, { recursive: true });
  process.env.BROWSERBASE_CONFIG_DIR = tmpDir;

  // Write test label files
  fs.writeFileSync(
    path.join(contextsDir, "latest"),
    "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  );
  fs.writeFileSync(
    path.join(contextsDir, "work"),
    "11111111-2222-3333-4444-555555555555\n",
  );
  fs.writeFileSync(path.join(contextsDir, "empty"), "");
});

afterAll(() => {
  process.env.BROWSERBASE_CONFIG_DIR = originalEnv;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("resolveContextLabel", () => {
  it("passes through raw UUIDs unchanged", async () => {
    const uuid = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
    expect(await resolveContextLabel(uuid)).toBe(uuid);
  });

  it("passes through ctx_ prefixed IDs unchanged", async () => {
    expect(await resolveContextLabel("ctx_abc123")).toBe("ctx_abc123");
  });

  it("resolves a label to its context ID", async () => {
    expect(await resolveContextLabel("latest")).toBe(
      "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    );
  });

  it("trims whitespace from label file contents", async () => {
    expect(await resolveContextLabel("work")).toBe(
      "11111111-2222-3333-4444-555555555555",
    );
  });

  it("returns the value as-is when label file does not exist", async () => {
    expect(await resolveContextLabel("nonexistent")).toBe("nonexistent");
  });

  it("returns the value as-is when label file is empty", async () => {
    expect(await resolveContextLabel("empty")).toBe("empty");
  });
});
