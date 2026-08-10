import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const coreTasksRoot = path.resolve(__dirname, "../../core/tasks");

function walk(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(fullPath));
      continue;
    }
    if (entry.isFile() && fullPath.endsWith(".ts")) {
      files.push(fullPath);
    }
  }

  return files;
}

describe("core task portability", () => {
  it("avoids compatibility-era page helpers in core tasks", () => {
    const forbiddenPatterns = [
      /\.locator\(/,
      /\.waitForSelector\(/,
      /\.waitForTimeout\(/,
      /\.goBack\(/,
      /\.goForward\(/,
      /\.setViewportSize\(/,
    ];

    for (const taskFile of walk(coreTasksRoot)) {
      const source = fs.readFileSync(taskFile, "utf8");
      for (const pattern of forbiddenPatterns) {
        expect(
          source,
          `${path.relative(coreTasksRoot, taskFile)} matched ${pattern}`,
        ).not.toMatch(pattern);
      }
    }
  });
});
