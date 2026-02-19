# Session Context

## User Prompts

### Prompt 1

Understand the current changes with respect to main in this branch. Explain the ordered, fallback levels of executionModel and how they propagate to any subtools requiring it to run.

### Prompt 2

You are an expert code reviewer. Follow these steps:

      1. If no PR number is provided in the args, run `gh pr list` to show open PRs
      2. If a PR number is provided, run `gh pr view <number>` to get PR details
      3. Run `gh pr diff <number>` to get the diff
      4. Analyze the changes and provide a thorough code review that includes:
         - Overview of what the PR does
         - Analysis of code quality and style
         - Specific suggestions for improvements
         - Any p...

### Prompt 3

add a few tests (not many, unit) for these changes

