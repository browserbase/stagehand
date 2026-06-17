import { NodeHtmlMarkdown } from "node-html-markdown";
import { z } from "zod";

import type { DriverCommandHandlers } from "./types.js";

const GetWhatSchema = z.enum([
  "box",
  "checked",
  "html",
  "markdown",
  "text",
  "title",
  "url",
  "value",
  "visible",
]);

export const pageInfoHandlers: DriverCommandHandlers = {
  async get(manager, params) {
    const { selector, what } = z
      .object({
        selector: z.string().optional(),
        what: GetWhatSchema,
      })
      .parse(params);
    const page = await manager.activePage();

    if (what === "url") return { url: page.url() };
    if (what === "title") return { title: await page.title() };

    const target = manager.resolveSelector(selector ?? "body");
    const locator = page.deepLocator(target);

    if (what === "text") return { text: await locator.textContent() };
    if (what === "html") return { html: await locator.innerHtml() };
    if (what === "value") return { value: await locator.inputValue() };
    if (what === "visible") return { visible: await locator.isVisible() };
    if (what === "checked") return { checked: await locator.isChecked() };
    if (what === "markdown")
      return {
        markdown: NodeHtmlMarkdown.translate(await locator.innerHtml()),
      };

    const { x, y } = await locator.centroid();
    return { x: Math.round(x), y: Math.round(y) };
  },

  async is(manager, params) {
    const { check, selector } = z
      .object({
        check: z.enum(["checked", "visible"]),
        selector: z.string().min(1),
      })
      .parse(params);
    const page = await manager.activePage();
    const locator = page.deepLocator(manager.resolveSelector(selector));
    return check === "visible"
      ? { visible: await locator.isVisible() }
      : { checked: await locator.isChecked() };
  },

  async eval(manager, params) {
    const { expression } = z
      .object({ expression: z.string().min(1) })
      .parse(params);
    const page = await manager.activePage();
    return { result: await page.evaluate(expression) };
  },
};
