import { fail } from "../errors.js";
import { outputTable } from "../output.js";
import { defaultSkillsApiBaseUrl, isRecord, responseDetail } from "./shared.js";

export interface BrowserSkill {
  hostname: string;
  task: string;
  slug: string;
  name: string;
  title: string;
  description: string;
  category: string;
  aliases: string[];
  tags: string[];
  source: string;
  updated: string;
  recommendedMethod: string;
  verified: boolean;
  proxies: boolean;
  sourceUrl: string;
  partner: boolean;
  screenshotUrls: string[];
  installCount: number;
}

export interface ListCatalogSkillsOptions {
  query?: string;
}

export async function listCatalogSkills(
  options: ListCatalogSkillsOptions = {},
): Promise<BrowserSkill[]> {
  const payload = await requestSkillsJson(skillsCatalogApiUrl(options.query));
  return parseSkillsResponse(payload);
}

export function prioritizeExactSkillMatch(
  skills: BrowserSkill[],
  query: string,
): BrowserSkill[] {
  const normalizedQuery = query.toLowerCase();
  return [...skills].sort((a, b) => {
    const aExact = a.slug.toLowerCase() === normalizedQuery;
    const bExact = b.slug.toLowerCase() === normalizedQuery;
    if (aExact === bExact) return 0;
    return aExact ? -1 : 1;
  });
}

interface SkillTableOptions {
  heading?: string;
  limit?: number;
  wide?: boolean;
}

export function outputSkillTable(
  skills: BrowserSkill[],
  options: SkillTableOptions = {},
): void {
  const visibleSkills = skills.slice(0, options.limit ?? skills.length);

  if (visibleSkills.length === 0) {
    console.log("No skills found.");
    return;
  }

  if (options.heading) {
    console.log(`${options.heading} (${skills.length})`);
  }

  outputTable(
    visibleSkills,
    [
      {
        header: "Skill",
        maxWidth: 42,
        value: (skill) => skill.slug,
      },
      {
        header: "Title",
        maxWidth: 42,
        value: (skill) => skill.title,
      },
      {
        header: "Method",
        maxWidth: 9,
        value: (skill) => skill.recommendedMethod,
      },
      {
        align: "right",
        header: "Installs",
        maxWidth: 8,
        value: (skill) => skill.installCount,
      },
      {
        header: "Tags",
        maxWidth: 36,
        value: (skill) => formatList(skill.tags),
      },
    ],
    { wide: options.wide },
  );

  console.log("Install with: browse skills add <skill>");
  if (visibleSkills.length < skills.length) {
    console.log(
      `Showing ${visibleSkills.length} of ${skills.length} skills. Use --limit, --all, --wide, or --json.`,
    );
  } else {
    console.log("Use --wide for full values or --json for full descriptions.");
  }
}

export function printSkillDetail(skill: BrowserSkill): void {
  console.log(skill.title);
  console.log(`Skill: ${skill.slug}`);
  console.log(`Method: ${skill.recommendedMethod}`);
  console.log(`Source: ${skill.source || "-"}`);
  console.log(`Installs: ${skill.installCount}`);
  console.log(`Tags: ${formatList(skill.tags)}`);

  if (skill.description) {
    console.log(`\n${skill.description}`);
  }

  console.log(`\nInstall: browse skills add ${skill.slug}`);
}

export function exactSkillMatch(
  skills: BrowserSkill[],
  query: string,
): BrowserSkill | undefined {
  const normalizedQuery = query.toLowerCase();
  return skills.find((skill) => skill.slug.toLowerCase() === normalizedQuery);
}

function formatList(values: string[]): string {
  return values.length > 0 ? values.join(", ") : "-";
}

function skillsCatalogApiUrl(query?: string): URL {
  const baseUrl =
    process.env.BROWSE_SKILLS_API_BASE_URL || defaultSkillsApiBaseUrl;
  const url = new URL(
    "api/skills",
    baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`,
  );

  if (query) {
    url.searchParams.set("q", query);
  }

  const bypassToken = process.env.BROWSE_ALPHA_TOKEN;
  if (bypassToken && !url.searchParams.has("x-vercel-protection-bypass")) {
    url.searchParams.append("x-vercel-protection-bypass", bypassToken);
  }

  return url;
}

async function requestSkillsJson(url: URL): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        accept: "application/json",
      },
    });
  } catch (error) {
    fail(
      `Failed to fetch skills: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!response.ok) {
    fail(
      `Failed to fetch skills: ${response.status} ${response.statusText}${await responseDetail(response)}`,
    );
  }

  try {
    return await response.json();
  } catch (error) {
    fail(
      `Failed to parse skills response: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function parseSkillsResponse(payload: unknown): BrowserSkill[] {
  if (!isRecord(payload) || !Array.isArray(payload.skills)) {
    fail('Invalid skills response: expected {"skills":[...]}.');
  }

  return payload.skills.map((skill, index) =>
    parseSkill(skill, `skills[${index}]`),
  );
}

function parseSkill(payload: unknown, context: string): BrowserSkill {
  if (!isRecord(payload)) {
    fail(`Invalid skills response for ${context}: skill must be an object.`);
  }

  return {
    hostname: requiredString(payload.hostname, context, "hostname"),
    task: requiredString(payload.task, context, "task"),
    slug: requiredString(payload.slug, context, "slug"),
    name: stringField(payload.name, context, "name"),
    title: stringField(payload.title, context, "title"),
    description: stringField(payload.description, context, "description"),
    category: stringField(payload.category, context, "category"),
    aliases: stringArrayField(payload.aliases, context, "aliases"),
    tags: stringArrayField(payload.tags, context, "tags"),
    source: stringField(payload.source, context, "source"),
    updated: stringField(payload.updated, context, "updated"),
    recommendedMethod: stringField(
      payload.recommendedMethod,
      context,
      "recommendedMethod",
    ),
    verified: booleanField(payload.verified, context, "verified"),
    proxies: booleanField(payload.proxies, context, "proxies"),
    sourceUrl: stringField(payload.sourceUrl, context, "sourceUrl"),
    partner: booleanField(payload.partner, context, "partner"),
    screenshotUrls: stringArrayField(
      payload.screenshotUrls,
      context,
      "screenshotUrls",
    ),
    installCount: numberField(payload.installCount, context, "installCount"),
  };
}

function requiredString(
  value: unknown,
  context: string,
  field: string,
): string {
  if (typeof value !== "string" || value.length === 0) {
    fail(
      `Invalid skills response for ${context}: ${field} must be a non-empty string.`,
    );
  }

  return value;
}

function stringField(value: unknown, context: string, field: string): string {
  if (typeof value !== "string") {
    fail(`Invalid skills response for ${context}: ${field} must be a string.`);
  }

  return value;
}

function booleanField(value: unknown, context: string, field: string): boolean {
  if (typeof value !== "boolean") {
    fail(`Invalid skills response for ${context}: ${field} must be a boolean.`);
  }

  return value;
}

function numberField(value: unknown, context: string, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail(`Invalid skills response for ${context}: ${field} must be a number.`);
  }

  return value;
}

function stringArrayField(
  value: unknown,
  context: string,
  field: string,
): string[] {
  if (
    !Array.isArray(value) ||
    value.some((entry) => typeof entry !== "string")
  ) {
    fail(
      `Invalid skills response for ${context}: ${field} must be an array of strings.`,
    );
  }

  return value;
}
