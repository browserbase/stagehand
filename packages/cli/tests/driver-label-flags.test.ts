import { Parser } from "@oclif/core";
import { describe, expect, it } from "vitest";

import Open from "../src/commands/open.js";

describe("remote open label flags", () => {
  it("accepts repeated labels before a positional URL without consuming the URL", async () => {
    const parsed = await Parser.parse(
      ["--remote", "--label", "Checkout", "--label", "Smoke test", "https://example.com"],
      { args: Open.args, flags: Open.flags },
    );
    expect(parsed.args.url).toBe("https://example.com");
    expect(parsed.flags.label).toEqual(["Checkout", "Smoke test"]);
    expect(parsed.flags.remote).toBe(true);
  });

  it("leaves labels absent for existing sessions when the flag is omitted", async () => {
    const parsed = await Parser.parse(["https://example.com", "--remote"], {
      args: Open.args,
      flags: Open.flags,
    });
    expect(parsed.flags.label).toBeUndefined();
  });
});
