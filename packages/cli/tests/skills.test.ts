import { createServer, type Server } from "node:http";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import { runCli } from "./helpers/run-cli.js";

const cleanupPaths: string[] = [];
const cleanupServers: Server[] = [];

afterEach(async () => {
  while (cleanupServers.length > 0) {
    const server = cleanupServers.pop();
    if (server) {
      await closeServer(server);
    }
  }

  while (cleanupPaths.length > 0) {
    const path = cleanupPaths.pop();
    if (path) {
      await rm(path, { recursive: true, force: true });
    }
  }
});

describe("skills", () => {
  it("lists Browse.sh catalog skills", async () => {
    const { server, baseUrl } = await startFakeSkillServer({
      "/api/skills": JSON.stringify({ skills: catalogSkills }),
    });
    cleanupServers.push(server);

    const result = await runCli(["skills", "list", "--format", "table"], {
      env: {
        BROWSE_SKILLS_API_BASE_URL: baseUrl,
      },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Skill");
    expect(result.stdout).toContain("Title");
    expect(result.stdout).toContain("Method");
    expect(result.stdout).toContain("Installs");
    expect(result.stdout).toContain("yelp.com/extract-reviews");
    expect(result.stdout).toContain("url-param");
    expect(result.stdout).toContain("yelp, reviews");
    expect(result.stdout).toContain("Install with: browse skills add <skill>");
    expect(result.stdout).not.toContain(catalogSkills[0].description);
  });

  it("defaults Browse.sh catalog skills to JSON when stdout is not a TTY", async () => {
    const { server, baseUrl } = await startFakeSkillServer({
      "/api/skills": JSON.stringify({ skills: catalogSkills }),
    });
    cleanupServers.push(server);

    const result = await runCli(["skills", "list"], {
      env: {
        BROWSE_SKILLS_API_BASE_URL: baseUrl,
      },
    });

    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout) as { skills: CatalogSkill[] };
    expect(payload.skills.map((skill) => skill.slug)).toEqual([
      "yelp.com/extract-reviews",
      "opentable.com/check-availability",
    ]);
  });

  it("prints Browse.sh catalog skills as JSON with --json", async () => {
    const { server, baseUrl } = await startFakeSkillServer({
      "/api/skills": JSON.stringify({ skills: catalogSkills }),
    });
    cleanupServers.push(server);

    const result = await runCli(["skills", "list", "--json"], {
      env: {
        BROWSE_SKILLS_API_BASE_URL: baseUrl,
      },
    });

    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout) as { skills: CatalogSkill[] };
    expect(payload.skills).toHaveLength(2);
  });

  it("limits Browse.sh catalog skills in table output", async () => {
    const { server, baseUrl } = await startFakeSkillServer({
      "/api/skills": JSON.stringify({ skills: catalogSkills }),
    });
    cleanupServers.push(server);

    const result = await runCli(
      ["skills", "list", "--format", "table", "--limit", "1"],
      {
        env: {
          BROWSE_SKILLS_API_BASE_URL: baseUrl,
        },
      },
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("yelp.com/extract-reviews");
    expect(result.stdout).not.toContain("opentable.com/check-availability");
    expect(result.stdout).toContain("Showing 1 of 2 skills");
  });

  it("shows all Browse.sh catalog skills in table output", async () => {
    const { server, baseUrl } = await startFakeSkillServer({
      "/api/skills": JSON.stringify({ skills: catalogSkills }),
    });
    cleanupServers.push(server);

    const result = await runCli(
      ["skills", "list", "--format", "table", "--limit", "1", "--all"],
      {
        env: {
          BROWSE_SKILLS_API_BASE_URL: baseUrl,
        },
      },
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("yelp.com/extract-reviews");
    expect(result.stdout).toContain("opentable.com/check-availability");
    expect(result.stdout).not.toContain("Showing 1 of 2 skills");
  });

  it("shows full skill table values with --wide", async () => {
    const longSlug =
      "very-long.example.com/search-listings-with-a-really-long-generated-suffix";
    const { server, baseUrl } = await startFakeSkillServer({
      "/api/skills": JSON.stringify({
        skills: [{ ...catalogSkills[0], slug: longSlug }],
      }),
    });
    cleanupServers.push(server);

    const narrowResult = await runCli(["skills", "list", "--format", "table"], {
      env: {
        BROWSE_SKILLS_API_BASE_URL: baseUrl,
      },
    });
    const wideResult = await runCli(
      ["skills", "list", "--format", "table", "--wide"],
      {
        env: {
          BROWSE_SKILLS_API_BASE_URL: baseUrl,
        },
      },
    );

    expect(narrowResult.exitCode).toBe(0);
    expect(narrowResult.stdout).not.toContain(longSlug);
    expect(wideResult.exitCode).toBe(0);
    expect(wideResult.stdout).toContain(longSlug);
  });

  it("finds Browse.sh catalog skills by query", async () => {
    const { server, baseUrl } = await startFakeSkillServer({
      "/api/skills": (_origin, requestUrl) => {
        expect(requestUrl.searchParams.get("q")).toBe("reviews");
        return JSON.stringify({ skills: [catalogSkills[0]] });
      },
    });
    cleanupServers.push(server);

    const result = await runCli(
      ["skills", "find", "reviews", "--format", "table"],
      {
        env: {
          BROWSE_SKILLS_API_BASE_URL: baseUrl,
        },
      },
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Skills matching "reviews" (1)');
    expect(result.stdout).toContain("Skill");
    expect(result.stdout).toContain("yelp.com/extract-reviews");
    expect(result.stdout).not.toContain(catalogSkills[0].description);
    expect(result.stdout).not.toContain("opentable.com/check-availability");
  });

  it("prints exact skill matches as concise detail output", async () => {
    const { server, baseUrl } = await startFakeSkillServer({
      "/api/skills": JSON.stringify({ skills: [catalogSkills[0]] }),
    });
    cleanupServers.push(server);

    const result = await runCli(
      ["skills", "find", "yelp.com/extract-reviews", "--format", "table"],
      {
        env: {
          BROWSE_SKILLS_API_BASE_URL: baseUrl,
        },
      },
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Yelp Review Extraction");
    expect(result.stdout).toContain("Skill: yelp.com/extract-reviews");
    expect(result.stdout).toContain("Method: url-param");
    expect(result.stdout).toContain(
      "Install: browse skills add yelp.com/extract-reviews",
    );
  });

  it("limits broad skill find table matches", async () => {
    const { server, baseUrl } = await startFakeSkillServer({
      "/api/skills": JSON.stringify({ skills: catalogSkills }),
    });
    cleanupServers.push(server);

    const result = await runCli(
      ["skills", "find", "restaurant", "--format", "table", "--limit", "1"],
      {
        env: {
          BROWSE_SKILLS_API_BASE_URL: baseUrl,
        },
      },
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("yelp.com/extract-reviews");
    expect(result.stdout).not.toContain("opentable.com/check-availability");
    expect(result.stdout).toContain("Showing 1 of 2 skills");
  });

  it("prioritizes exact slug matches in skill find JSON", async () => {
    const { server, baseUrl } = await startFakeSkillServer({
      "/api/skills": JSON.stringify({
        skills: [catalogSkills[1], catalogSkills[0]],
      }),
    });
    cleanupServers.push(server);

    const result = await runCli(
      ["skills", "find", "yelp.com/extract-reviews", "--json"],
      {
        env: {
          BROWSE_SKILLS_API_BASE_URL: baseUrl,
        },
      },
    );

    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout) as {
      query: string;
      skills: CatalogSkill[];
    };
    expect(payload.query).toBe("yelp.com/extract-reviews");
    expect(payload.skills.map((skill) => skill.slug)).toEqual([
      "yelp.com/extract-reviews",
      "opentable.com/check-availability",
    ]);
  });

  it("rejects malformed catalog responses", async () => {
    const { server, baseUrl } = await startFakeSkillServer({
      "/api/skills": JSON.stringify({ skills: [{ slug: "bad" }] }),
    });
    cleanupServers.push(server);

    const result = await runCli(["skills", "list"], {
      env: {
        BROWSE_SKILLS_API_BASE_URL: baseUrl,
      },
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Invalid skills response");
  });

  it("reports catalog API failures", async () => {
    const { server, baseUrl } = await startFakeSkillServer({
      "/api/skills": {
        status: 500,
        body: JSON.stringify({ error: "catalog unavailable" }),
        contentType: "application/json",
      },
    });
    cleanupServers.push(server);

    const result = await runCli(["skills", "list"], {
      env: {
        BROWSE_SKILLS_API_BASE_URL: baseUrl,
      },
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      "Failed to fetch skills: 500 Internal Server Error: catalog unavailable",
    );
  });

  it("fails cleanly when a non-generated skill is missing from the catalog", async () => {
    const stubDir = await createTempDir("browse-skills-missing-bin-");
    const logPath = join(stubDir, "npx.log");
    await writeNpxStub(stubDir, logPath);
    // Empty server: the file API returns 404 for the requested id.
    const { server, baseUrl } = await startFakeSkillServer({});
    cleanupServers.push(server);

    const result = await runCli(
      ["skills", "add", "amazon.com/buy-something-fake"],
      {
        env: {
          BROWSE_SKILLS_API_BASE_URL: baseUrl,
          PATH: stubDir,
        },
      },
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      'Skill "amazon.com/buy-something-fake" not found in the catalog',
    );
    expect(result.stderr).toContain("browse skills find amazon.com");
    // It must NOT have shelled out to clone the browse.sh repo.
    await expect(
      readFile(logPath, "utf8").catch(() => ""),
    ).resolves.not.toContain("browserbase/browse.sh");
  });

  it("installs suffix-shaped catalog skills from GitHub when the file API returns 404", async () => {
    const stubDir = await createTempDir("browse-skills-suffix-catalog-bin-");
    const logPath = join(stubDir, "npx.log");
    await writeNpxStub(stubDir, logPath);
    const { server, baseUrl } = await startFakeSkillServer({});
    cleanupServers.push(server);

    const result = await runCli(
      ["skills", "add", "airline.example/book-flight"],
      {
        env: {
          BROWSE_SKILLS_API_BASE_URL: baseUrl,
          PATH: stubDir,
        },
      },
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).not.toContain("Downloaded");
    await expect(readFile(logPath, "utf8")).resolves.toContain(
      "--yes skills add browserbase/browse.sh --skill airline.example/book-flight",
    );
  });

  it("installs suffix-shaped catalog skills from GitHub when the file API is unavailable and no Blob fallback exists", async () => {
    const stubDir = await createTempDir(
      "browse-skills-suffix-unavailable-bin-",
    );
    const logPath = join(stubDir, "npx.log");
    await writeNpxStub(stubDir, logPath);
    const { server, baseUrl } = await startFakeSkillServer({
      "/api/skills/airline.example/book-flight/files": {
        status: 500,
        body: "server error",
      },
    });
    cleanupServers.push(server);

    const result = await runCli(
      ["skills", "add", "airline.example/book-flight"],
      {
        env: {
          BROWSE_SKILLS_API_BASE_URL: baseUrl,
          BROWSE_SKILLS_BLOB_BASE_URL: baseUrl,
          PATH: stubDir,
        },
      },
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).not.toContain("Downloaded");
    await expect(readFile(logPath, "utf8")).resolves.toContain(
      "--yes skills add browserbase/browse.sh --skill airline.example/book-flight",
    );
  });

  it("downloads generated skills from the Browse.sh file API before installing", async () => {
    const stubDir = await createTempDir("browse-skills-api-bin-");
    const configHome = await createTempDir("browse-skills-config-");
    const logPath = join(stubDir, "npx.log");
    await writeNpxStub(stubDir, logPath);

    const { server, baseUrl } = await startFakeSkillServer({
      "/api/skills/mcdonalds.order.online/order-delivery-42q71n/files": (
        origin,
      ) =>
        JSON.stringify({
          skillId: "mcdonalds.order.online/order-delivery-42q71n",
          files: [
            {
              path: "SKILL.md",
              url: `${origin}/downloads/order-delivery/SKILL.md`,
            },
            {
              path: "REFERENCE.md",
              url: `${origin}/downloads/order-delivery/REFERENCE.md`,
            },
          ],
        }),
      "/downloads/order-delivery/SKILL.md": [
        "---",
        "name: order-delivery",
        "description: Place a McDonald's delivery order.",
        "---",
        "",
        "# Order delivery",
        "",
      ].join("\n"),
      "/downloads/order-delivery/REFERENCE.md": "Reference\n",
    });
    cleanupServers.push(server);

    const result = await runCli(
      ["skills", "add", "mcdonalds.order.online/order-delivery-42q71n"],
      {
        env: {
          BROWSE_SKILLS_API_BASE_URL: baseUrl,
          PATH: stubDir,
          XDG_CONFIG_HOME: configHome,
        },
      },
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Downloaded 2 skill files");

    const installPath = join(
      configHome,
      "browserbase",
      "skills",
      "mcdonalds.order.online",
      "order-delivery-42q71n",
    );
    await expect(
      readFile(join(installPath, "SKILL.md"), "utf8"),
    ).resolves.toContain("name: order-delivery");
    await expect(
      readFile(join(installPath, "REFERENCE.md"), "utf8"),
    ).resolves.toBe("Reference\n");
    await expect(readFile(logPath, "utf8")).resolves.toContain(
      `--yes skills add ${installPath}`,
    );
  });

  it("falls back to direct SKILL.md download when the file API is unavailable for a suffix-shaped skill", async () => {
    const stubDir = await createTempDir("browse-skills-api-fallback-bin-");
    const configHome = await createTempDir(
      "browse-skills-api-fallback-config-",
    );
    const logPath = join(stubDir, "npx.log");
    await writeNpxStub(stubDir, logPath);

    const { server, baseUrl } = await startFakeSkillServer({
      "/api/skills/mcdonalds.order.online/order-delivery-42q71n/files": {
        status: 500,
        body: "server error",
      },
      "/skills/mcdonalds.order.online/order-delivery-42q71n/SKILL.md": [
        "---",
        "name: order-delivery",
        "description: Place a McDonald's delivery order.",
        "---",
        "",
        "# Order delivery",
        "",
      ].join("\n"),
    });
    cleanupServers.push(server);

    const result = await runCli(
      ["skills", "add", "mcdonalds.order.online/order-delivery-42q71n"],
      {
        env: {
          BROWSE_SKILLS_API_BASE_URL: baseUrl,
          BROWSE_SKILLS_BLOB_BASE_URL: baseUrl,
          PATH: stubDir,
          XDG_CONFIG_HOME: configHome,
        },
      },
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Downloaded 1 skill file");

    const installPath = join(
      configHome,
      "browserbase",
      "skills",
      "mcdonalds.order.online",
      "order-delivery-42q71n",
    );
    await expect(
      readFile(join(installPath, "SKILL.md"), "utf8"),
    ).resolves.toContain("name: order-delivery");
    await expect(readFile(logPath, "utf8")).resolves.toContain(
      `--yes skills add ${installPath}`,
    );
  });

  it("rejects invalid skill ids", async () => {
    const result = await runCli(["skills", "add", "../bad"]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Invalid skill id");
  });

  it("guides the user when the skill id is missing", async () => {
    const result = await runCli(["skills", "add"]);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("Missing skill id");
    expect(result.stderr).toContain("<domain>/<task>");
    expect(result.stderr).toContain("browse skills find");
  });

  it("rejects unsafe API file paths", async () => {
    const stubDir = await createTempDir("browse-skills-unsafe-bin-");
    const configHome = await createTempDir("browse-skills-unsafe-config-");
    const logPath = join(stubDir, "npx.log");
    await writeNpxStub(stubDir, logPath);

    const { server, baseUrl } = await startFakeSkillServer({
      "/api/skills/mcdonalds.order.online/order-delivery-42q71n/files": (
        origin,
      ) =>
        JSON.stringify({
          skillId: "mcdonalds.order.online/order-delivery-42q71n",
          files: [
            { path: "SKILL.md", url: `${origin}/downloads/SKILL.md` },
            { path: "../bad", url: `${origin}/downloads/bad` },
          ],
        }),
    });
    cleanupServers.push(server);

    const result = await runCli(
      ["skills", "add", "mcdonalds.order.online/order-delivery-42q71n"],
      {
        env: {
          BROWSE_SKILLS_API_BASE_URL: baseUrl,
          PATH: stubDir,
          XDG_CONFIG_HOME: configHome,
        },
      },
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("unsafe file path");
  });
});

interface CatalogSkill {
  aliases: string[];
  category: string;
  description: string;
  hostname: string;
  installCount: number;
  name: string;
  partner: boolean;
  proxies: boolean;
  recommendedMethod: string;
  screenshotUrls: string[];
  slug: string;
  source: string;
  sourceUrl: string;
  tags: string[];
  task: string;
  title: string;
  updated: string;
  verified: boolean;
}

const catalogSkills: CatalogSkill[] = [
  {
    aliases: ["business reviews"],
    category: "local-search",
    description: "Extract a Yelp business's rating distribution and reviews.",
    hostname: "yelp.com",
    installCount: 12,
    name: "extract-reviews",
    partner: true,
    proxies: true,
    recommendedMethod: "url-param",
    screenshotUrls: [],
    slug: "yelp.com/extract-reviews",
    source: "browserbase",
    sourceUrl:
      "https://github.com/browserbase/browse.sh/blob/main/skills/yelp.com/extract-reviews/SKILL.md",
    tags: ["yelp", "reviews"],
    task: "extract-reviews",
    title: "Yelp Review Extraction",
    updated: "2026-05-11",
    verified: true,
  },
  {
    aliases: ["restaurant availability"],
    category: "reservations",
    description: "Find OpenTable restaurant reservation availability.",
    hostname: "opentable.com",
    installCount: 8,
    name: "check-availability",
    partner: true,
    proxies: false,
    recommendedMethod: "api",
    screenshotUrls: [],
    slug: "opentable.com/check-availability",
    source: "browserbase",
    sourceUrl:
      "https://github.com/browserbase/browse.sh/blob/main/skills/opentable.com/check-availability/SKILL.md",
    tags: ["opentable", "reservations"],
    task: "check-availability",
    title: "OpenTable Availability",
    updated: "2026-05-11",
    verified: false,
  },
];

async function createTempDir(prefix: string): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), prefix));
  cleanupPaths.push(path);
  return path;
}

async function writeNpxStub(stubDir: string, logPath: string): Promise<void> {
  const stubPath = join(stubDir, "npx");
  await writeFile(
    stubPath,
    ["#!/bin/sh", 'printf \'%s\\n\' "$*" >> "$BB_STUB_LOG"', "exit 0", ""].join(
      "\n",
    ),
  );
  await chmod(stubPath, 0o755);
  process.env.BB_STUB_LOG = logPath;
}

type FakeFile =
  | string
  | ((origin: string, requestUrl: URL) => string)
  | {
      body?: string;
      contentType?: string;
      status: number;
    };

async function startFakeSkillServer(files: Record<string, FakeFile>): Promise<{
  server: Server;
  baseUrl: string;
}> {
  const server = createServer((request, response) => {
    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
    const bodySource = files[requestUrl.pathname];
    if (bodySource === undefined) {
      response.writeHead(404);
      response.end("not found");
      return;
    }

    const address = server.address();
    if (!address || typeof address === "string") {
      response.writeHead(500);
      response.end("missing address");
      return;
    }

    const origin = `http://127.0.0.1:${address.port}`;
    const status = typeof bodySource === "object" ? bodySource.status : 200;
    const body =
      typeof bodySource === "function"
        ? bodySource(origin, requestUrl)
        : typeof bodySource === "object"
          ? (bodySource.body ?? "")
          : bodySource;
    const contentType =
      typeof bodySource === "object"
        ? (bodySource.contentType ?? "text/plain")
        : requestUrl.pathname.endsWith(".json") ||
            requestUrl.pathname.endsWith("/files") ||
            requestUrl.pathname === "/api/skills"
          ? "application/json"
          : "text/plain";

    response.writeHead(status, {
      "content-type": contentType,
    });
    response.end(body);
  });

  await new Promise<void>((resolvePromise) => {
    server.listen(0, "127.0.0.1", resolvePromise);
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Could not start fake Blob server.");
  }

  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
  };
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolvePromise();
    });
  });
}
