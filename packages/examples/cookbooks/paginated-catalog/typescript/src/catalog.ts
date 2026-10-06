import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod/v4";

export const bookSchema = z.object({
  title: z.string().trim().min(1),
  price: z.string().trim().min(1),
  availability: z.string().trim().min(1),
});
export const pageSchema = z.object({ books: z.array(bookSchema).min(1) });
const checkpointSchema = z.object({
  version: z.literal(1),
  source: z.url(),
  complete: z.boolean(),
  pages: z.array(z.object({ url: z.url(), books: z.array(bookSchema).min(1) })),
});
type Book = z.infer<typeof bookSchema>;

export function parseMaxPages(value = "2"): number {
  const limit = Number(value);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
    throw new Error("MAX_PAGES must be an integer between 1 and 100");
  return limit;
}

async function atomicJson(path: string, data: unknown): Promise<void> {
  await writeFile(`${path}.tmp`, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  await rename(`${path}.tmp`, path);
}

export interface CatalogDriver {
  goto(url: string): Promise<void>;
  url(): Promise<string>;
  extract(): Promise<unknown>;
  advance(): Promise<boolean>;
}

export async function exportCatalog(
  driver: CatalogDriver,
  source: string,
  maxPages: number,
  out = "out",
) {
  const origin = new URL(source).origin;
  if (!/^https?:$/.test(new URL(source).protocol))
    throw new Error("CATALOG_URL must use HTTP or HTTPS");
  await mkdir(out, { recursive: true });
  const path = join(out, "checkpoint.json");
  let state: z.infer<typeof checkpointSchema> = { version: 1, source, complete: false, pages: [] };
  try {
    state = checkpointSchema.parse(JSON.parse(await readFile(path, "utf8")));
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
  if (state.complete && state.pages.length === 0)
    throw new Error("Completed checkpoint has no pages");
  if (state.source !== source)
    throw new Error("Checkpoint belongs to another CATALOG_URL; use a fresh output directory");
  const visited = new Set(state.pages.map((page) => page.url));
  if (
    visited.size !== state.pages.length ||
    state.pages.some((page) => new URL(page.url).origin !== origin)
  )
    throw new Error("Checkpoint contains a cycle or an unapproved origin");
  if (!state.complete) {
    // The last saved page is revisited only to discover Next, never to repeat extraction.
    const saved = state.pages.at(-1);
    await driver.goto(saved?.url ?? source);
    let revisit = Boolean(saved);
    while (true) {
      const url = await driver.url();
      if (new URL(url).origin !== origin)
        throw new Error(`Navigation left the catalog origin: ${url}`);
      if (revisit && url !== saved?.url)
        throw new Error("Checkpoint page redirected; start a fresh export");
      if (!revisit) {
        if (visited.has(url)) throw new Error(`Pagination cycle at ${url}`);
        if (state.pages.length >= maxPages)
          throw new Error(`MAX_PAGES=${maxPages} reached; checkpoint saved`);
        const { books } = pageSchema.parse(await driver.extract());
        state.pages.push({ url, books });
        visited.add(url);
        await atomicJson(path, state);
      }
      revisit = false;
      if (!(await driver.advance())) {
        state.complete = true;
        await atomicJson(path, state);
        break;
      }
      if ((await driver.url()) === url)
        throw new Error(`Next-page action did not navigate from ${url}`);
    }
  }
  const unique = new Map<string, Book>();
  for (const page of state.pages) {
    for (const book of page.books)
      unique.set(JSON.stringify([book.title, book.price, book.availability]), book);
  }
  const books = [...unique.values()];
  const catalog = { pages: state.pages.length, count: books.length, books };
  await atomicJson(join(out, "catalog.json"), catalog);
  return catalog;
}
