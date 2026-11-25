#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import https from "node:https";
import { getCurrentDirPath } from "./runtimePaths.js";

const currentDir = getCurrentDirPath();

const SDK_REPOS = {
  java: {
    repo: "browserbase/stagehand-java",
    title: "Java SDK",
    description: "Official Stagehand SDK for Java",
    outputPath: "v3/sdk/java.mdx",
  },
  python: {
    repo: "browserbase/stagehand-python",
    title: "Python SDK",
    description: "Official Stagehand SDK for Python",
    outputPath: "v3/sdk/python.mdx",
  },
  ruby: {
    repo: "browserbase/stagehand-ruby",
    title: "Ruby SDK",
    description: "Official Stagehand SDK for Ruby",
    outputPath: "v3/sdk/ruby.mdx",
  },
  go: {
    repo: "browserbase/stagehand-go",
    title: "Go SDK",
    description: "Official Stagehand SDK for Go",
    outputPath: "v3/sdk/go.mdx",
  },
};

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    https
      .get(
        url,
        {
          headers: {
            "User-Agent": "Stagehand-Docs-Sync",
          },
        },
        (res) => {
          if (res.statusCode === 301 || res.statusCode === 302) {
            fetchUrl(res.headers.location).then(resolve).catch(reject);
            return;
          }

          if (res.statusCode !== 200) {
            reject(new Error(`HTTP ${res.statusCode}: ${url}`));
            return;
          }

          let data = "";
          res.on("data", (chunk) => (data += chunk));
          res.on("end", () => resolve(data));
          res.on("error", reject);
        },
      )
      .on("error", reject);
  });
}

function processReadmeContent(content, config) {
  let processed = content;

  processed = processed.replace(/<!--[\s\S]*?-->/g, "");

  processed = processed.replace(/<div[^>]*>[\s\S]*?<\/div>/gi, "");
  processed = processed.replace(/<p[^>]*align[^>]*>[\s\S]*?<\/p>/gi, "");
  processed = processed.replace(/<picture>[\s\S]*?<\/picture>/gi, "");

  processed = processed.replace(/<a[^>]*>[\s]*<img[^>]*>[\s]*<\/a>/gi, "");
  processed = processed.replace(/<img[^>]*badge[^>]*>/gi, "");
  processed = processed.replace(/<img[^>]*shields\.io[^>]*>/gi, "");
  processed = processed.replace(/<a[^>]*>\s*<picture>[\s\S]*?<\/picture>\s*<\/a>/gi, "");

  processed = processed.replace(/^\s*(\[!\[.*?\]\(.*?\)\]\(.*?\)\s*)+/gm, "");
  processed = processed.replace(/^\s*!\[.*?\]\(https:\/\/.*?badge.*?\)\s*/gm, "");
  processed = processed.replace(/\[!\[.*?\]\(.*?badge.*?\)\]\(.*?\)/g, "");

  processed = processed.replace(/<a[^>]*href[^>]*><img[^>]*><\/a>/gi, "");

  processed = processed.replace(/<code>\\`([^`]*?)\\`<\/code>/g, "`$1`");
  processed = processed.replace(/<code>`([^`]*?)`<\/code>/g, "`$1`");
  processed = processed.replace(/<code>([^<]*?)<\/code>/g, "`$1`");

  processed = processed.replace(/\[([^\]]+)\]\(([^)]+)\(([^)]+)\)([^)]*)\)/g, "[$1]($2)");

  const repoUrl = `https://github.com/${config.repo}`;
  processed = processed.replace(
    /\]\((?!http)(?!#)(?!mailto)([^)]+)\)/g,
    `](${repoUrl}/blob/main/$1)`,
  );

  processed = processed.replace(/```kotlin/g, "```java");

  processed = processed.replace(/^#\s+.*\n+/, "");

  processed = processed.replace(/\n{4,}/g, "\n\n\n");

  processed = processed.replace(/<img[^>]*>/gi, "");

  processed = processed.replace(/<a[^>]*>\s*<\/a>/gi, "");

  processed = processed.replace(/^\s+$/gm, "");

  return processed.trim();
}

function generateFrontmatter(config) {
  return `---
title: "${config.title}"
description: "${config.description}"
---

<Note>
  This documentation is automatically synced from the [${config.title} GitHub repository](https://github.com/${config.repo}).
</Note>

`;
}

async function syncSdk(language, config) {
  const rawUrl = `https://raw.githubusercontent.com/${config.repo}/main/README.md`;

  console.log(`Fetching ${language} SDK docs from ${rawUrl}...`);

  try {
    const readme = await fetchUrl(rawUrl);
    const processedContent = processReadmeContent(readme, config);
    const frontmatter = generateFrontmatter(config);
    const mdxContent = frontmatter + processedContent;

    const outputDir = path.dirname(`${currentDir}/../${config.outputPath}`);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const outputFile = `${currentDir}/../${config.outputPath}`;
    fs.writeFileSync(outputFile, mdxContent, "utf8");

    console.log(`✓ ${language} SDK docs written to ${config.outputPath}`);
    return true;
  } catch (error) {
    console.error(`✗ Failed to sync ${language} SDK: ${error.message}`);
    return false;
  }
}

async function main() {
  console.log("Syncing SDK documentation from GitHub...\n");

  const results = await Promise.all(
    Object.entries(SDK_REPOS).map(([lang, config]) => syncSdk(lang, config)),
  );

  const successCount = results.filter(Boolean).length;
  const totalCount = results.length;

  console.log(`\nDone! ${successCount}/${totalCount} SDKs synced successfully.`);

  if (successCount < totalCount) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
