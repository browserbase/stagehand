# Changesets

This folder stores [changesets](https://github.com/changesets/changesets) for unreleased changes. When you change a public SDK, the extension, or the protocol compatibility contract, run `just changeset` to create one.

## Writing a good changeset

A changeset summary becomes the release-note line in `CHANGELOG.md`. Keep it:

- **One terse, user-facing sentence.** Users read changelogs to learn what changed for them, not how you implemented it.
- **Imperative or past-tense.** "Fix X" or "Fixed X", not "Fixes X" or "This PR fixes X".
- **Specific.** Name the method, flag, or behavior. Backtick code identifiers.
- **Free of internal detail.** No file names, test notes, refactoring rationale, or multi-paragraph explanations.

### Good examples

```
Fix `waitForLoadState("networkidle")` timing out on an already-idle page
```

```
Fix response header lookups reporting a header with an empty value as missing on HTTP/2 responses
```

```
Add `--size regular|large|xlarge` to `browse cloud sessions create` to select the browser size
```

```
Respect host-only cookie domains when filtering context cookies by URL
```

### Bad → good rewrites

**Bad:** This changeset updates the internal cookie-filtering logic in the extension to correctly handle host-only domains (domains without a leading dot). Previously, host-only cookies were matched against subdomains, which is incorrect per RFC 6265. The fix checks for the leading dot before allowing subdomain matching. Tests added in `test/cookies.spec.ts`.

**Good:** Respect host-only cookie domains when filtering context cookies by URL

---

**Bad:** Fixed an issue where the waitForLoadState method would time out when called with "networkidle" on a page that had already finished loading and had no pending network requests. The root cause was that the idle check only ran on new requests. Added request counting.

**Good:** Fix `waitForLoadState("networkidle")` timing out on an already-idle page

## Which packages and bump levels?

| Change                                          | Bump                                               |
| ----------------------------------------------- | -------------------------------------------------- |
| Bug fix in one SDK                              | Patch for that SDK only                            |
| New feature in one SDK                          | Minor for that SDK only                            |
| Extension-only fix                              | Extension patch, plus each SDK that should ship it |
| Protocol correction requiring no new capability | Protocol patch, plus affected implementations      |
| Backward-compatible protocol addition           | Protocol minor, plus affected implementations      |
| Breaking protocol change                        | Protocol major and a coordinated release           |

Select only the packages intended for release. The release workflow handles the rest.
