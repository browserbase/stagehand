<!--
Only a human may request changes to this file. Keep additions rare and limited to durable, repository-wide rules.
-->

- For stacked PRs, target each PR at its immediate predecessor; when a parent changes, merge it into its immediate child and resolve conflicts normally.
- After a parent is squash-merged as `S`, ensure its child contains the parent’s final tip and verify that tip and `S` have identical trees. Record the child’s current commit, run `git merge --no-edit S^` and `git merge --no-edit -s ours S`, then use `git diff <recorded-commit> HEAD` to confirm that the child’s files did not change and inspect `git diff --merge-base S HEAD` as the final PR diff before pushing. Stop if either diff contains unexpected changes.
