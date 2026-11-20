import os from "node:os";

const GITHUB_ISSUES_NEW_URL = "https://github.com/browserbase/stagehand/issues/new";
const ISSUE_TEMPLATE = "bug_report.md";
const MAX_URL_LENGTH = 8000;

export interface BugReportEnv {
  browseVersion: string;
  nodeVersion: string;
  os: string;
  agent: string;
}

export interface BugReportOptions {
  title?: string;
  env: BugReportEnv;
}

export function buildBugReportUrl(options: BugReportOptions): string {
  const { title = "", env } = options;

  const body = buildBody(env);
  const safeTitle = redactSensitive(title);

  const params = new URLSearchParams();
  params.set("template", ISSUE_TEMPLATE);
  if (safeTitle) {
    params.set("title", safeTitle);
  }
  params.set("body", body);

  const url = `${GITHUB_ISSUES_NEW_URL}?${params.toString()}`;

  if (url.length > MAX_URL_LENGTH) {
    return truncateUrl(url, MAX_URL_LENGTH);
  }

  return url;
}

function buildBody(env: BugReportEnv): string {
  const safeEnv = {
    browseVersion: redactSensitive(env.browseVersion),
    nodeVersion: redactSensitive(env.nodeVersion),
    os: redactSensitive(env.os),
    agent: redactSensitive(env.agent),
  };

  return `## What happened

<!-- Describe the issue you encountered -->

## Expected behavior

<!-- What did you expect to happen? -->

## Steps to reproduce

1. 
2. 
3. 

## Environment

| Key | Value |
| --- | ----- |
| browse | ${safeEnv.browseVersion} |
| node | ${safeEnv.nodeVersion} |
| os | ${safeEnv.os} |
| agent | ${safeEnv.agent} |

## Additional context

<!-- Any other relevant information, screenshots, or error messages -->
`;
}

const SENSITIVE_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  { pattern: /bb_live_[A-Za-z0-9_-]+/g, replacement: "[REDACTED_API_KEY]" },
  { pattern: /bb_test_[A-Za-z0-9_-]+/g, replacement: "[REDACTED_API_KEY]" },
  { pattern: /sk-[A-Za-z0-9_-]{20,}/g, replacement: "[REDACTED_KEY]" },
  { pattern: /Bearer\s+[A-Za-z0-9_.-]+/gi, replacement: "Bearer [REDACTED]" },
  { pattern: /token=[A-Za-z0-9_.-]+/gi, replacement: "token=[REDACTED]" },
  { pattern: /sig=[A-Za-z0-9_.-]+/gi, replacement: "sig=[REDACTED]" },
  { pattern: /signature=[A-Za-z0-9_.-]+/gi, replacement: "signature=[REDACTED]" },
  { pattern: /key=[A-Za-z0-9_.-]+/gi, replacement: "key=[REDACTED]" },
  { pattern: /secret=[A-Za-z0-9_.-]+/gi, replacement: "secret=[REDACTED]" },
];

export function redactSensitive(value: string): string {
  let result = value;

  for (const { pattern, replacement } of SENSITIVE_PATTERNS) {
    result = result.replace(pattern, replacement);
  }

  result = redactHomePath(result);

  return result;
}

function redactHomePath(value: string): string {
  const home = os.homedir();
  if (!home) return value;

  const escaped = home.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const homePattern = new RegExp(escaped, "g");
  return value.replace(homePattern, "~");
}

function truncateUrl(url: string, maxLength: number): string {
  if (url.length <= maxLength) return url;

  const truncationMarker = "\n\n<!-- truncated -->";
  const parsed = new URL(url);
  const body = parsed.searchParams.get("body") ?? "";

  const overhead = url.length - body.length;
  const maxBodyLength = maxLength - overhead - truncationMarker.length;

  if (maxBodyLength <= 0) {
    parsed.searchParams.delete("body");
    return parsed.toString().slice(0, maxLength);
  }

  const truncatedBody = body.slice(0, maxBodyLength) + truncationMarker;
  parsed.searchParams.set("body", truncatedBody);
  return parsed.toString();
}
