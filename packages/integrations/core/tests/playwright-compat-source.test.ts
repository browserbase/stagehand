import { expect, it, vi } from "vitest";
import { createPlaywrightCompatRuntime } from "../src/facade/index.js";

type CompatPage = { url(): string };
type CompatContext = { pages(): unknown[] };
type CompatBrowser = { contexts(): unknown[] };

// SDKs ship this function's source as a standalone script and evaluate it inside
// a batch callback, so it must not close over anything but the `__name` helper.
it("exports the compat runtime as self-contained source", async () => {
  const source = createPlaywrightCompatRuntime.toString();
  const create = new Function("__name", `return (${source});`)(
    (target: unknown) => target,
  ) as typeof createPlaywrightCompatRuntime;
  const rawPage = {
    pageId: "test-page",
    url: vi.fn(async () => "https://example.com/"),
    evaluate: vi.fn(async () => ({ width: 800, height: 600 })),
    waitForLoadState: vi.fn(async () => undefined),
  };
  const runtime = await create({
    page: rawPage,
    context: { pages: vi.fn(async () => [rawPage]) },
  } as unknown as Parameters<typeof createPlaywrightCompatRuntime>[0]);

  expect((runtime.page as CompatPage).url()).toBe("https://example.com/");
  const [page] = (runtime.context as CompatContext).pages();
  expect(page).toBe(runtime.page);
  const [context] = (runtime.browser as CompatBrowser).contexts();
  expect(context).toBe(runtime.context);
});
