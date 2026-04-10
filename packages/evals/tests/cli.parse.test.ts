import { describe, expect, it } from "vitest";
import { parseArgs } from "../cli.js";

describe("cli parseArgs", () => {
  it("treats --new-runner as a boolean flag without consuming the next option", () => {
    const parsed = parseArgs([
      "act",
      "--new-runner",
      "-e",
      "browserbase",
      "-t",
      "1",
    ]);

    expect(parsed.target).toBe("act");
    expect(parsed.options["new-runner"]).toBe(true);
    expect(parsed.options.env).toBe("browserbase");
    expect(parsed.options.trials).toBe(1);
  });
});
