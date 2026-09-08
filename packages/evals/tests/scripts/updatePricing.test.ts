import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EvalsError } from "../../errors.js";
import { updatePricing } from "../../scripts/update-pricing.js";

let directory: string;
let target: string;
const original = JSON.stringify({
  as_of: "2026-01-01",
  models: {
    "openai/example": {
      input_per_m: 1,
      cached_input_per_m: 0.1,
      output_per_m: 4,
      source: "fixture",
    },
    "anthropic/pending": {
      input_per_m: null,
      cached_input_per_m: null,
      output_per_m: null,
      source: "needs owner input",
    },
  },
});

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "stagehand-pricing-test-"));
  target = path.join(directory, "pricing.json");
  await writeFile(target, original);
  vi.stubEnv("EVAL_PRICING_SOURCE", "gateway");
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await rm(directory, { recursive: true, force: true });
});

describe("pricing refresh", () => {
  it.each([null, {}, { data: [] }, { data: [null, { id: "broken" }] }])(
    "preserves the existing file when HTTP200 has an unusable catalog: %j",
    async (body) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => Response.json(body)),
      );
      await expect(updatePricing(target)).rejects.toBeInstanceOf(EvalsError);
      expect(await readFile(target, "utf8")).toBe(original);
    },
  );

  it("does not unprice every model when a catalog has no matching IDs", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          data: [{ id: "unrelated/model", pricing: { input: "0.000001", output: "0.000004" } }],
        }),
      ),
    );
    await expect(updatePricing(target)).rejects.toThrow(/currently priced models/u);
    expect(await readFile(target, "utf8")).toBe(original);
  });

  it("keeps HTTP failures typed and excludes response secrets", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("credential=do-not-emit", { status: 503 })),
    );
    const failure = updatePricing(target);
    await expect(failure).rejects.toBeInstanceOf(EvalsError);
    await expect(failure).rejects.toThrow("gateway models: HTTP 503");
    await expect(failure).rejects.not.toThrow("do-not-emit");
    expect(await readFile(target, "utf8")).toBe(original);
  });

  it("falls back from an unusable gateway and retains observed cache-write rates for owner input", async () => {
    vi.stubEnv("EVAL_PRICING_SOURCE", "");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ data: [] }))
      .mockResolvedValueOnce(
        Response.json({
          data: [
            { id: "openai/example", pricing: { prompt: "0.000002", completion: "0.000008" } },
            {
              id: "anthropic/pending",
              pricing: {
                prompt: "0.000003",
                completion: "0.000015",
                input_cache_write: "0.00000375",
              },
            },
          ],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    await updatePricing(target);
    const updated = JSON.parse(await readFile(target, "utf8"));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(updated.models["openai/example"].input_per_m).toBe(2);
    expect(updated.models["anthropic/pending"]).toMatchObject({ input_per_m: null });
    expect(updated.models["anthropic/pending"].note).toContain("cache_write=3.75");
  });
});
