// Wraps @changesets/changelog-github so changesets merged through a mirrored
// external contributor PR credit the original contributor, not github-actions.
const base = require("@changesets/changelog-github").default;

const OWNED_RE = /<!-- external-contributor-pr:owned source-pr=(\d+) /;
const OVERRIDE_RE = /^\s*(?:pr|pull|pull\s+request|commit|author|user):/im;
const MIRROR_AUTHOR = "github-actions[bot]";

async function github(path) {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
    },
  });
  if (!response.ok) throw new Error(`GitHub API ${path} failed: ${response.status}`);
  return response.json();
}

async function creditMirroredContributor(changeset, repo) {
  if (!changeset.commit || OVERRIDE_RE.test(changeset.summary)) return changeset;
  const pulls = await github(`/repos/${repo}/commits/${changeset.commit}/pulls`);
  const mirror = pulls.find((pull) => pull.merged_at && pull.user?.login === MIRROR_AUTHOR);
  const source = mirror?.body?.match(OWNED_RE)?.[1];
  if (!source) return changeset;
  const original = await github(`/repos/${repo}/pulls/${source}`);
  const overrides = `pr: #${source}\ncommit: ${changeset.commit}\nauthor: @${original.user.login}\n`;
  return { ...changeset, summary: `${overrides}${changeset.summary}` };
}

module.exports = {
  ...base,
  async getReleaseLine(changeset, type, options) {
    let credited = changeset;
    try {
      credited = await creditMirroredContributor(changeset, options.repo);
    } catch (error) {
      console.warn(`Could not credit mirrored contributor for ${changeset.id}: ${error.message}`);
    }
    return base.getReleaseLine(credited, type, options);
  },
};
