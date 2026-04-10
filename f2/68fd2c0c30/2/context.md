# Session Context

## User Prompts

### Prompt 1

You are an expert code reviewer. Follow these steps:

      1. If no PR number is provided in the args, run `gh pr list` to show open PRs
      2. If a PR number is provided, run `gh pr view <number>` to get PR details
      3. Run `gh pr diff <number>` to get the diff
      4. Analyze the changes and provide a thorough code review that includes:
         - Overview of what the PR does
         - Analysis of code quality and style
         - Specific suggestions for improvements
         - Any p...

### Prompt 2

address 3,4,5. for 1 and 2, add a log (level 2:debug)

### Prompt 3

don't use console logs, use logger pattern that is present throughout the repo

### Prompt 4

You are an expert code reviewer. Follow these steps:

      1. If no PR number is provided in the args, run `gh pr list` to show open PRs
      2. If a PR number is provided, run `gh pr view <number>` to get PR details
      3. Run `gh pr diff <number>` to get the diff
      4. Analyze the changes and provide a thorough code review that includes:
         - Overview of what the PR does
         - Analysis of code quality and style
         - Specific suggestions for improvements
         - Any p...

### Prompt 5

askusertool on how you expect to resolve all these issues

### Prompt 6

you can keep exclude. Was referring to the getaction logger issue

### Prompt 7

what would it look like if we wanted to fully migrate chromie to the managed agents service from antrhopic?

https://www.anthropic.com/engineering/managed-agents
https://platform.claude.com/docs/en/managed-agents/overview

### Prompt 8

what chromie did you look into??

