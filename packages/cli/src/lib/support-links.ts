/**
 * Centralized support links for the browse CLI.
 *
 * These URLs are single-sourced so they can be updated in one place
 * when vanity URLs or redirects are set up later.
 */

export const DISCORD_INVITE_URL = "https://discord.gg/stagehand";

const GITHUB_ISSUES_BASE_URL = "https://github.com/browserbase/stagehand/issues";

export const GITHUB_ISSUES_URL = GITHUB_ISSUES_BASE_URL;

export type LinkSourceParam = "discord_command" | "issues_command" | "help_footer" | "error_hint";

/**
 * Returns the GitHub issues URL with UTM-style tracking params.
 *
 * GitHub tolerates query params on issue URLs — they're ignored but
 * visible in referrer logs and new-issue prefill. Discord invite links
 * do not tolerate query params, so we cannot add tracking there.
 */
export function getGitHubIssuesUrl(source: LinkSourceParam): string {
  const params = new URLSearchParams({
    utm_source: "browse_cli",
    utm_medium: source,
  });
  return `${GITHUB_ISSUES_BASE_URL}?${params.toString()}`;
}
