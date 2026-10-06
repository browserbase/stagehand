import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { exportCatalog, parseMaxPages, type CatalogDriver } from "../src/catalog.js";

const source = "https://catalog.test/1";
function fixture(end = 3) {
  let current = 1;
  const extracted: number[] = [];
  const driver: CatalogDriver = {
    goto: async (url) => {
      current = Number(new URL(url).pathname.slice(1));
    },
    url: async () => `https://catalog.test/${current}`,
    extract: async () => {
      extracted.push(current);
      return { books: [{ title: `Book ${current}`, price: "£1", availability: "In stock" }] };
    },
    advance: async () => {
      if (current === end) return false;
      current++;
      return true;
    },
  };
  return { driver, extracted };
}
async function temporary(run: (out: string) => Promise<void>) {
  const out = await mkdtemp(join(tmpdir(), "catalog-"));
  try {
    await run(out);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
}

await test("limit persists progress; resume extracts only missing pages and completed rerun makes no browser calls", async () => {
  await temporary(async (out) => {
    const first = fixture();
    await assert.rejects(exportCatalog(first.driver, source, 2, out), /MAX_PAGES/);
    await assert.rejects(readFile(join(out, "catalog.json")), { code: "ENOENT" });
    assert.deepEqual(first.extracted, [1, 2]);
    const second = fixture();
    assert.equal((await exportCatalog(second.driver, source, 3, out)).count, 3);
    assert.deepEqual(second.extracted, [3]);
    const unused = fixture();
    unused.driver.goto = async () => {
      throw new Error("should not navigate");
    };
    assert.equal((await exportCatalog(unused.driver, source, 3, out)).pages, 3);
  });
});

await test("rejects mismatched source, empty extraction, pagination cycle, unchanged URL, and cross-origin navigation", async () => {
  await temporary(async (out) => {
    await exportCatalog(fixture(1).driver, source, 2, out);
    await assert.rejects(
      exportCatalog(fixture().driver, "https://other.test/1", 2, out),
      /another CATALOG_URL/,
    );
  });
  for (const failure of ["empty", "cycle", "unchanged", "origin"]) {
    await temporary(async (out) => {
      const { driver } = fixture();
      if (failure === "empty") driver.extract = async () => ({ books: [] });
      if (failure === "cycle")
        driver.advance = async () => {
          await driver.goto(source);
          return true;
        };
      if (failure === "unchanged") driver.advance = async () => true;
      if (failure === "origin") {
        const advance = driver.advance.bind(driver);
        driver.advance = async () => {
          await advance();
          driver.url = async () => "https://other.test/2";
          return true;
        };
      }
      await assert.rejects(exportCatalog(driver, source, 2, out));
    });
  }
});

await test("deduplicates identical records across pages", async () => {
  await temporary(async (out) => {
    const { driver } = fixture(2);
    driver.extract = async () => ({
      books: [{ title: "Same book", price: "£1", availability: "In stock" }],
    });
    assert.equal((await exportCatalog(driver, source, 2, out)).count, 1);
  });
});

await test("page budget rejects invalid and excessive values", () => {
  assert.equal(parseMaxPages(), 2);
  for (const value of ["0", "-1", "1.2", "abc", "101", "Infinity"])
    assert.throws(() => parseMaxPages(value));
});

await test("a corrupt checkpoint cannot silently publish an empty catalog", async () => {
  await temporary(async (out) => {
    await writeFile(
      join(out, "checkpoint.json"),
      JSON.stringify({ version: 1, source, complete: true, pages: [] }),
    );
    await assert.rejects(exportCatalog(fixture().driver, source, 2, out), /no pages/);
    await writeFile(join(out, "checkpoint.json"), "broken json");
    await assert.rejects(exportCatalog(fixture().driver, source, 2, out));
  });
});
