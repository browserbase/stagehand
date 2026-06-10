import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  jsonResponse,
  startFakeBrowserbaseServer,
  type FakeBrowserbaseServer,
} from "./helpers/fake-browserbase-server.js";
import { runCli } from "./helpers/run-cli.js";

interface TemplateFixture {
  category: string[];
  commands: string[];
  description: string;
  shortDescription: string;
  slug: string;
  source: string;
  steps: string[];
  tags: string[];
  title: string;
}

const templates: TemplateFixture[] = [
  {
    category: ["Web Automation", "E-commerce"],
    commands: [
      "npx create-browser-app --template amazon-product-scraping",
      "uvx create-browser-app --template amazon-product-scraping",
    ],
    description: "Automatically scrape Amazon search results.",
    shortDescription: "Extract product data from Amazon search results.",
    slug: "amazon-product-scraping",
    source: "Browserbase",
    steps: ["Open Amazon", "Extract product data"],
    tags: ["TypeScript", "Python", "Stagehand"],
    title: "Scrape Amazon products",
  },
  {
    category: ["Form Automation"],
    commands: ["npx create-browser-app --template dynamic-form-filling"],
    description: "Fill forms from natural language.",
    shortDescription: "Intelligently fill out forms.",
    slug: "dynamic-form-filling",
    source: "Browserbase",
    steps: ["Open form", "Submit answers"],
    tags: ["TypeScript", "Stagehand"],
    title: "AI-powered form filling automation",
  },
  {
    category: ["Web Automation"],
    commands: [
      "npx create-browser-app --template google-trends-keywords",
      "uvx create-browser-app --template google-trends-keywords",
    ],
    description: "Extract trending search keywords from Google Trends.",
    shortDescription: "Extract trending search keywords.",
    slug: "google-trends-keywords",
    source: "Browserbase",
    steps: ["Open Google Trends", "Extract keywords"],
    tags: ["TypeScript", "Python", "Stagehand"],
    title: "Extract trending keywords from Google Trends",
  },
];

const cleanupPaths: string[] = [];

afterEach(async () => {
  while (cleanupPaths.length > 0) {
    const path = cleanupPaths.pop();
    if (path) {
      await rm(path, { recursive: true, force: true });
    }
  }
});

describe("templates commands", () => {
  it("lists templates from the templates API", async () => {
    await withTemplatesApi(async ({ baseUrl, requests }) => {
      const result = await runCli(["templates", "list", "--format", "table"], {
        env: { BROWSERBASE_TEMPLATES_API: baseUrl },
      });

      expect(result.exitCode).toBe(0);
      expect(requests).toHaveLength(1);
      expect(requests[0]?.method).toBe("GET");
      expect(requests[0]?.path).toBe("/?scope=all");
      expect(result.stdout).toContain("Template");
      expect(result.stdout).toContain("Title");
      expect(result.stdout).toContain("Source");
      expect(result.stdout).toContain("Categories");
      expect(result.stdout).toContain("amazon-product-scraping");
      expect(result.stdout).toContain("Scrape Amazon products");
      expect(result.stdout).toContain("Web Automation, E-commerce");
      expect(result.stdout).not.toContain(templates[0].shortDescription);
    });
  });

  it("passes list filters as query parameters", async () => {
    await withTemplatesApi(async ({ baseUrl, requests }) => {
      const result = await runCli(
        [
          "templates",
          "list",
          "--category",
          "Form Automation",
          "--tag",
          "TypeScript",
          "--source",
          "Browserbase",
          "--format",
          "table",
        ],
        {
          env: { BROWSERBASE_TEMPLATES_API: baseUrl },
        },
      );

      expect(result.exitCode).toBe(0);
      const requestUrl = new URL(requests[0]?.path ?? "/", "http://localhost");
      expect(requestUrl.searchParams.get("category")).toBe("Form Automation");
      expect(requestUrl.searchParams.get("tag")).toBe("TypeScript");
      expect(requestUrl.searchParams.get("source")).toBe("Browserbase");
      expect(result.stdout).toContain("dynamic-form-filling");
      expect(result.stdout).not.toContain("amazon-product-scraping");
    });
  });

  it("prints list results as JSON", async () => {
    await withTemplatesApi(async ({ baseUrl }) => {
      const result = await runCli(["templates", "list", "--tag", "Python"], {
        env: { BROWSERBASE_TEMPLATES_API: baseUrl },
      });

      expect(result.exitCode).toBe(0);
      const payload = JSON.parse(result.stdout) as {
        templates: TemplateFixture[];
      };
      expect(payload.templates.map((template) => template.slug)).toEqual([
        "amazon-product-scraping",
        "google-trends-keywords",
      ]);
    });
  });

  it("prints list results as JSON with --json", async () => {
    await withTemplatesApi(async ({ baseUrl }) => {
      const result = await runCli(["templates", "list", "--json"], {
        env: { BROWSERBASE_TEMPLATES_API: baseUrl },
      });

      expect(result.exitCode).toBe(0);
      const payload = JSON.parse(result.stdout) as {
        templates: TemplateFixture[];
      };
      expect(payload.templates).toHaveLength(3);
    });
  });

  it("prints exact template details from a slug", async () => {
    await withTemplatesApi(async ({ baseUrl, requests }) => {
      const result = await runCli(
        ["templates", "find", "google-trends-keywords", "--format", "table"],
        {
          env: { BROWSERBASE_TEMPLATES_API: baseUrl },
        },
      );

      expect(result.exitCode).toBe(0);
      expect(requests).toHaveLength(1);
      expect(requests[0]?.path).toBe("/google-trends-keywords");
      expect(result.stdout).toContain(
        "Extract trending keywords from Google Trends",
      );
      expect(result.stdout).toContain("slug: google-trends-keywords");
      expect(result.stdout).toContain("Scaffold commands:");
    });
  });

  it("prints exact template JSON with the same shape as search results", async () => {
    await withTemplatesApi(async ({ baseUrl }) => {
      const result = await runCli(
        ["templates", "find", "google-trends-keywords", "--json"],
        {
          env: { BROWSERBASE_TEMPLATES_API: baseUrl },
        },
      );

      expect(result.exitCode).toBe(0);
      const payload = JSON.parse(result.stdout) as {
        query: string;
        templates: TemplateFixture[];
      };
      expect(payload.query).toBe("google-trends-keywords");
      expect(payload.templates.map((template) => template.slug)).toEqual([
        "google-trends-keywords",
      ]);
    });
  });

  it("finds templates by partial query", async () => {
    await withTemplatesApi(async ({ baseUrl, requests }) => {
      const result = await runCli(
        ["templates", "find", "amazon", "--format", "table"],
        {
          env: { BROWSERBASE_TEMPLATES_API: baseUrl },
        },
      );

      expect(result.exitCode).toBe(0);
      expect(requests.map((request) => request.path)).toEqual([
        "/amazon",
        "/?scope=all",
      ]);
      expect(result.stdout).toContain('Templates matching "amazon" (1)');
      expect(result.stdout).toContain("Template");
      expect(result.stdout).toContain("amazon-product-scraping");
      expect(result.stdout).not.toContain(templates[0].shortDescription);
      expect(result.stdout).not.toContain("dynamic-form-filling");
    });
  });

  it("prints find matches as JSON", async () => {
    await withTemplatesApi(async ({ baseUrl }) => {
      const result = await runCli(["templates", "find", "Python", "--json"], {
        env: { BROWSERBASE_TEMPLATES_API: baseUrl },
      });

      expect(result.exitCode).toBe(0);
      const payload = JSON.parse(result.stdout) as {
        query: string;
        templates: TemplateFixture[];
      };
      expect(payload.query).toBe("Python");
      expect(payload.templates.map((template) => template.slug)).toEqual([
        "amazon-product-scraping",
        "google-trends-keywords",
      ]);
    });
  });

  it("clones TypeScript templates with create-browser-app via npx", async () => {
    const stubDir = await createTempDir("browse-templates-ts-stub-");
    const logPath = join(stubDir, "commands.log");
    await writeExecutable(
      join(stubDir, "npx"),
      [
        "#!/bin/sh",
        'if [ "$1" = "--version" ]; then',
        "  exit 0",
        "fi",
        'printf \'npx %s\\n\' "$*" >> "$BB_STUB_LOG"',
        'project="$2"',
        'mkdir -p "$project"',
        'printf \'{"name":"stub-app","scripts":{"dev":"tsx index.ts"}}\\n\' > "$project/package.json"',
        "printf 'BROWSERBASE_API_KEY=\\n' > \"$project/.env.example\"",
      ].join("\n"),
    );

    await withTemplatesApi(async ({ baseUrl, requests }) => {
      const cwd = await createTempDir("browse-templates-ts-project-");
      const dest = join(cwd, "my-scraper");
      const result = await runCli(
        ["templates", "clone", "amazon-product-scraping", dest],
        {
          env: {
            BB_STUB_LOG: logPath,
            BROWSERBASE_TEMPLATES_API: baseUrl,
            PATH: `${stubDir}:${process.env.PATH ?? ""}`,
          },
        },
      );

      expect(result.exitCode).toBe(0);
      expect(requests.map((request) => request.path)).toEqual([
        "/amazon-product-scraping",
      ]);
      expect(await readFile(logPath, "utf8")).toContain(
        "npx create-browser-app@latest my-scraper --template amazon-product-scraping",
      );
      expect(result.stdout).toContain(
        `Scaffolding typescript/amazon-product-scraping into ${dest}...`,
      );
      expect(result.stdout).toContain(`Template scaffolded to ${dest}`);
      expect(result.stdout).toContain(`cd ${dest}`);
      expect(result.stdout).toContain("npm install");
      expect(result.stdout).toContain("cp .env.example .env");
      expect(result.stdout).toContain("npm run dev");
      expect(await readFile(join(dest, "package.json"), "utf8")).toContain(
        "stub-app",
      );
    });
  });

  it("clones Python templates with create-browser-app via uvx", async () => {
    const stubDir = await createTempDir("browse-templates-py-stub-");
    const logPath = join(stubDir, "commands.log");
    await writeExecutable(
      join(stubDir, "uvx"),
      [
        "#!/bin/sh",
        'if [ "$1" = "--version" ]; then',
        "  exit 0",
        "fi",
        'printf \'uvx %s\\n\' "$*" >> "$BB_STUB_LOG"',
        'project="$2"',
        'mkdir -p "$project"',
        'printf \'print("hello")\\n\' > "$project/main.py"',
        "printf 'BROWSERBASE_API_KEY=\\n' > \"$project/.env.example\"",
        'printf \'[project]\\nname = "stub-py"\\nversion = "0.1.0"\\n\' > "$project/pyproject.toml"',
      ].join("\n"),
    );

    await withTemplatesApi(async ({ baseUrl }) => {
      const cwd = await createTempDir("browse-templates-py-project-");
      const dest = join(cwd, "py-scraper");
      const result = await runCli(
        [
          "templates",
          "clone",
          "amazon-product-scraping",
          "--language",
          "python",
          dest,
        ],
        {
          env: {
            BB_STUB_LOG: logPath,
            BROWSERBASE_TEMPLATES_API: baseUrl,
            PATH: `${stubDir}:${process.env.PATH ?? ""}`,
          },
        },
      );

      expect(result.exitCode).toBe(0);
      expect(await readFile(logPath, "utf8")).toContain(
        "uvx create-browser-app py-scraper --template amazon-product-scraping",
      );
      expect(result.stdout).toContain(
        `Scaffolding python/amazon-product-scraping into ${dest}...`,
      );
      expect(result.stdout).toContain("uv sync");
      expect(result.stdout).toContain("cp .env.example .env");
      expect(result.stdout).toContain("python main.py");
      expect(await readFile(join(dest, "main.py"), "utf8")).toContain("hello");
    });
  });

  it("prints clone results as JSON", async () => {
    const stubDir = await createTempDir("browse-templates-json-stub-");
    await writeExecutable(
      join(stubDir, "npx"),
      [
        "#!/bin/sh",
        'if [ "$1" = "--version" ]; then',
        "  exit 0",
        "fi",
        'project="$2"',
        'mkdir -p "$project"',
        'printf \'{"name":"json-app"}\\n\' > "$project/package.json"',
      ].join("\n"),
    );

    await withTemplatesApi(async ({ baseUrl }) => {
      const cwd = await createTempDir("browse-templates-json-project-");
      const dest = join(cwd, "json-scraper");
      const result = await runCli(
        ["templates", "clone", "amazon-product-scraping", dest, "--json"],
        {
          env: {
            BROWSERBASE_TEMPLATES_API: baseUrl,
            PATH: `${stubDir}:${process.env.PATH ?? ""}`,
          },
        },
      );

      expect(result.exitCode).toBe(0);
      const payload = JSON.parse(result.stdout) as {
        destination: string;
        language: string;
        ok: boolean;
        slug: string;
      };
      expect(payload).toMatchObject({
        destination: dest,
        language: "typescript",
        ok: true,
        slug: "amazon-product-scraping",
      });
    });
  });

  it("fails when clone destination already exists", async () => {
    await withTemplatesApi(async ({ baseUrl }) => {
      const dest = await createTempDir("browse-templates-existing-");
      const result = await runCli(
        ["templates", "clone", "amazon-product-scraping", dest],
        {
          env: { BROWSERBASE_TEMPLATES_API: baseUrl },
        },
      );

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain(`Destination already exists: ${dest}`);
    });
  });
});

async function withTemplatesApi(
  callback: (server: FakeBrowserbaseServer) => Promise<void>,
): Promise<void> {
  const server = await startFakeBrowserbaseServer((request, response) => {
    const url = new URL(request.path, "http://localhost");
    const slug = url.pathname.replace(/^\/+/, "");

    if (slug) {
      const template = templates.find((entry) => entry.slug === slug);
      if (!template) {
        jsonResponse(response, 404, { message: "Template not found" });
        return;
      }
      jsonResponse(response, 200, { template });
      return;
    }

    const category = url.searchParams.get("category");
    const source = url.searchParams.get("source");
    const tag = url.searchParams.get("tag");
    const filteredTemplates = templates.filter((template) => {
      return (
        (!category || template.category.includes(category)) &&
        (!source || template.source === source) &&
        (!tag || template.tags.includes(tag))
      );
    });

    jsonResponse(response, 200, { templates: filteredTemplates });
  });

  try {
    await callback(server);
  } finally {
    await server.close();
  }
}

async function createTempDir(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  cleanupPaths.push(directory);
  return directory;
}

async function writeExecutable(
  pathname: string,
  contents: string,
): Promise<void> {
  await writeFile(pathname, `${contents}\n`);
  await chmod(pathname, 0o755);
}
