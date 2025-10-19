import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "fs";
import os from "os";
import path from "path";

import { LLMCache } from "../lib/cache/LLMCache";
import { LLMProvider } from "../lib/llm/LLMProvider";
import { LogLine } from "../types/log";

const noopLogger: (line: LogLine) => void = () => {};

test("LLMCache respects explicit cache directory override", () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "stagehand-cache-"));
  const customDir = path.join(tmpRoot, "custom-cache");

  try {
    new LLMCache(noopLogger, customDir);
    assert.ok(
      fs.existsSync(customDir),
      "expected custom cache directory to be created",
    );
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test(
  "LLMCache reads cache directory from STAGEHAND_CACHE_DIR env var",
  () => {
    const tmpRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "stagehand-env-cache-"),
    );
    const envDir = path.join(tmpRoot, "env-cache");
    const previous = process.env.STAGEHAND_CACHE_DIR;
    process.env.STAGEHAND_CACHE_DIR = envDir;

    try {
      new LLMCache(noopLogger);
      assert.ok(
        fs.existsSync(envDir),
        "expected env-configured cache directory to be created",
      );
    } finally {
      if (previous === undefined) {
        delete process.env.STAGEHAND_CACHE_DIR;
      } else {
        process.env.STAGEHAND_CACHE_DIR = previous;
      }
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  },
);

test("LLMProvider skips creating cache directory when caching disabled", () => {
  const tmpRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "stagehand-provider-cache-"),
  );
  const disabledDir = path.join(tmpRoot, "disabled-cache");

  try {
    new LLMProvider(noopLogger, false, disabledDir);
    assert.ok(
      !fs.existsSync(disabledDir),
      "expected cache directory to be absent when caching is disabled",
    );
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

