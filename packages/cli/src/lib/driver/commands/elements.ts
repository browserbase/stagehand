import { z } from "zod";

import type { DriverCommandHandlers } from "./types.js";

export const elementsHandlers: DriverCommandHandlers = {
  async click(manager, params) {
    const { selector } = z
      .object({ selector: z.string().min(1) })
      .parse(params);
    const stagehand = await manager.stagehandInstance();
    await stagehand.act({
      arguments: [],
      description: "click element",
      method: "click",
      selector: manager.resolveSelector(selector),
    } as never);
    return { clicked: true };
  },

  async fill(manager, params) {
    const { pressEnter, selector, value } = z
      .object({
        pressEnter: z.boolean().optional(),
        selector: z.string().min(1),
        value: z.string(),
      })
      .parse(params);
    const stagehand = await manager.stagehandInstance();
    await stagehand.act({
      arguments: [value],
      description: "fill element",
      method: "fill",
      selector: manager.resolveSelector(selector),
    } as never);
    if (pressEnter) {
      const page = await manager.activePage();
      await page.keyPress("Enter");
    }
    return { filled: true, pressedEnter: pressEnter ?? false };
  },

  async select(manager, params) {
    const { selector, values } = z
      .object({
        selector: z.string().min(1),
        values: z.array(z.string()).min(1),
      })
      .parse(params);
    const page = await manager.activePage();
    const selected = await page
      .deepLocator(manager.resolveSelector(selector))
      .selectOption(values);
    return { selected };
  },

  async upload(manager, params) {
    const { files, selector } = z
      .object({
        files: z.array(z.string()).min(1),
        selector: z.string().min(1),
      })
      .parse(params);
    const page = await manager.activePage();
    await page
      .deepLocator(manager.resolveSelector(selector))
      .setInputFiles(files.length === 1 ? files[0]! : files);
    return { files, uploaded: true };
  },

  async highlight(manager, params) {
    const { durationMs, selector } = z
      .object({
        durationMs: z.number().int().positive().optional(),
        selector: z.string().min(1),
      })
      .parse(params);
    const page = await manager.activePage();
    await page
      .deepLocator(manager.resolveSelector(selector))
      .highlight({ durationMs: durationMs ?? 2000 });
    return { highlighted: true };
  },
};
