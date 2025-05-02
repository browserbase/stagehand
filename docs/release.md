# Releasing

We use [Changesets](https://github.com/changesets/changesets) to version and release our packages.

When we merge to main, the release workflow will:

1. Create a release pull request with:
   - A version bump for the package calculated by the changesets.
   - A changelog entry summarizing the changes in the release.
1. Create an `alpha` version of the package with whatever is merged to main, and you can install it with `npm install @browserbasehq/stagehand@alpha`. This is useful for testing the release before it's published to the `latest` tag.

When the pull request is merged, the release workflow will publish the package to npm with the version calculated by the changesets.

For more information on how changesets work, see the [changesets docs](https://github.com/changesets/changesets) and our [release.yml file](/.github/workflows/release.yml).

# Manually Releasing

> [!WARNING]
> You should not need to manually release unless absolutely necessary. Our automated release workflow handles this for you when changes are merged to main.

When you're ready to cut a release, start by versioning the packages:

```
npx changeset version
```

This will consume the changesets in [`.changeset`](../.changeset) and update the [changelog](../CHANGELOG.md) and [`package.json`](../package.json):

```
% git status --short
 M CHANGELOG.md
 M package.json
```

Based on the versions implications declared by the changesets, the package version will be updated to the next patch, minor, or major:

```diff
   "name": "@browserbasehq/stagehand",
-  "version": "1.3.0",
+  "version": "1.3.1",
```

Since we updated the `package.json`, we should also update the lockfile ([`package-lock.json`](../package-lock.json)) for tidiness:

```
npm install
```

Now the lockfile should be updated:

```
% git status --short
 M CHANGELOG.md
 M package-lock.json
 M package.json
```

The diff will look something like this:

```diff
 {
   "name": "@browserbasehq/stagehand",
-  "version": "1.3.0",
+  "version": "1.3.1",
   "lockfileVersion": 3,
   "requires": true,
   "packages": {
     "": {
       "name": "@browserbasehq/stagehand",
-      "version": "1.3.0",
+      "version": "1.3.1",
```

At this point we're ready to commit our changes.
It's probably a good idea to have some consistency around the name of this commit message:

```
git commit -am 'Version Packages'
```

Ok, now it's time to publish the release.
Before we do, we have to build the artifacts that comprise the tarball.
Let's clean our working directory first so that we don't accidentally include anything in the tarball that shouldn't be there:

```
% git clean -fxd -e .env
Removing dist/
Removing lib/dom/build/
Removing node_modules/
```

Let's reinstall dependencies and build the artifacts:

```
pnpm install && pnpm run build
```

Now we're ready to publish to NPM. You have to be logged in via the `npm` CLI and have to be part of the `@browserbasehq` org:

```
pnpm changeset publish
```

Congratulations! You just published a new version of `@browserbasehq/stagehand`. 🤘

In the process of publishing, Changesets created an [annotated git tag](https://git-scm.com/book/en/v2/Git-Basics-Tagging):

```
🦋  Creating git tag...
🦋  New tag:  v1.3.1
```

Let's push the commit and tag to GitHub for posterity:

```
git push --follow-tags
```
