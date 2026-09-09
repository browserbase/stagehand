import type { Action, ObserveResult, Page, Stagehand } from "@browserbasehq/stagehand";
import boxen from "boxen";
import chalk from "chalk";
import fs from "fs/promises";
import { z } from "zod/v4";

export function announce(message: string, title?: string) {
  console.log(
    boxen(message, {
      padding: 1,
      margin: 3,
      title: title || "Stagehand",
    }),
  );
}

export function getEnvVar(name: string, required = true): string | undefined {
  const value = process.env[name];
  if (!value && required) {
    throw new Error(`${name} not found in environment variables`);
  }
  return value;
}

export function validateZodSchema(schema: z.ZodTypeAny, data: unknown) {
  try {
    schema.parse(data);
    return true;
  } catch {
    return false;
  }
}

export async function drawObserveOverlay(page: Page, results: ObserveResult) {
  const xpathList = results.data.map((result: Action) => result.selector);

  const validXpaths = xpathList.filter((xpath) => xpath !== "xpath=");

  await page.evaluate((selectors) => {
    selectors.forEach((selector) => {
      let element;
      if (selector.startsWith("xpath=")) {
        const xpath = selector.substring(6);
        element = document.evaluate(
          xpath,
          document,
          null,
          XPathResult.FIRST_ORDERED_NODE_TYPE,
          null,
        ).singleNodeValue;
      } else {
        element = document.querySelector(selector);
      }

      if (element instanceof HTMLElement) {
        const overlay = document.createElement("div");
        overlay.setAttribute("stagehandObserve", "true");
        const rect = element.getBoundingClientRect();
        overlay.style.position = "absolute";
        overlay.style.left = rect.left + "px";
        overlay.style.top = rect.top + "px";
        overlay.style.width = rect.width + "px";
        overlay.style.height = rect.height + "px";
        overlay.style.backgroundColor = "rgba(255, 255, 0, 0.3)";
        overlay.style.pointerEvents = "none";
        overlay.style.zIndex = "10000";
        document.body.appendChild(overlay);
      }
    });
  }, validXpaths);
}

export async function clearOverlays(page: Page) {
  await page.evaluate(() => {
    const elements = document.querySelectorAll('[stagehandObserve="true"]');
    elements.forEach((el) => {
      const parent = el.parentNode;
      while (el.firstChild) {
        parent?.insertBefore(el.firstChild, el);
      }
      parent?.removeChild(el);
    });
  });
}

export async function simpleCache(instruction: string, actionToCache: Action) {
  try {
    let cache: Record<string, Action> = {};
    try {
      const existingCache = await fs.readFile("cache.json", "utf-8");
      cache = JSON.parse(existingCache);
    } catch {
      // no file yet
    }

    cache[instruction] = actionToCache;

    await fs.writeFile("cache.json", JSON.stringify(cache, null, 2));
  } catch (error) {
    console.error(chalk.red("Failed to save to cache:"), error);
  }
}

export async function readCache(instruction: string): Promise<Action | null> {
  try {
    const existingCache = await fs.readFile("cache.json", "utf-8");
    const cache: Record<string, Action> = JSON.parse(existingCache);
    return cache[instruction] || null;
  } catch {
    return null;
  }
}

export async function actWithCache(
  stagehand: Stagehand,
  page: Page,
  instruction: string,
): Promise<void> {
  const cachedAction = await readCache(instruction);
  if (cachedAction) {
    console.log(chalk.blue("Using cached action for:"), instruction);
    await stagehand.act(cachedAction);
    return;
  }

  const results = await stagehand.observe(instruction);
  console.log(chalk.blue("Got results:"), results);

  const actionToCache = results.data[0];
  console.log(chalk.blue("Taking cacheable action:"), actionToCache);
  await simpleCache(instruction, actionToCache);
  await drawObserveOverlay(page, results);
  await page.waitForTimeout(1000);
  await clearOverlays(page);

  await stagehand.act(actionToCache);
}
