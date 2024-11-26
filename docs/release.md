# Releasing

We use [Changesets](https://github.com/changesets/changesets) to version and release our packages.

When we merge to main, the release workflow will:

1. Create a release pull request with:
   - A version bump for the package calculated by the changesets.
   - A changelog entry summarizing the changes in the release.
1. Create a canary version of the package with a version number including the commit hash.

When the pull request is merged, the release workflow will publish the package to npm with the version calculated by the changesets.

For more information on how changesets work, see the [changesets docs](https://github.com/changesets/changesets) and our [release.yml file](/.github/workflows/release.yml).
