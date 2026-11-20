import type { ElementFacts } from "./actionFacts.js";

const ELEMENT_PATH = /^(?:\/[a-z][\w-]*(?:\[\d+\])?)+$/u;
const HEADING_PATH = /\/h([1-6])(?:\[\d+\])?$/u;

export function isNativeElementPath(path: string | undefined): path is string {
  return path !== undefined && ELEMENT_PATH.test(path);
}

export function normalizeHeading(value: string): string {
  return value.normalize("NFKC").replace(/\s+/gu, " ").trim().toLowerCase();
}

export function headingLevel(path: string): number | undefined {
  const match = HEADING_PATH.exec(path);
  return match ? Number(match[1]) : undefined;
}

export function visibleNativeHeading(
  path: string | undefined,
  fact: ElementFacts | undefined,
  name: string,
): { path: string; level: number } | undefined {
  if (!isNativeElementPath(path)) return;
  const level = headingLevel(path);
  if (!level || !fact?.visible || fact.tag !== `h${level}` || fact.text.length >= 160) return;
  if (normalizeHeading(name) !== normalizeHeading(fact.text)) return;
  return { path, level };
}
