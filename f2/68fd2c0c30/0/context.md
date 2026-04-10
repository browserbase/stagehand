# Session Context

## User Prompts

### Prompt 1

we're fixing the accumulated inconsistencies around the @packages/core/examples/ directory. I went ahead and moved all examples inside v3 to top level examples, updated those that are env:BROWSERBASE (non-cua) to remove the need of having to pass a model api key and just pass the model as a string, but there are other things that need to be addressed:
1. all example names should be highfin based (example-here.ts) 
2. fix all imports if any failed to autoupdate
3. remove the changelog
4. billtest...

### Prompt 2

checkout the main version of the code in paramtetrizeapikey example

### Prompt 3

fix the mcp example imports

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

I fixed. the only thing we need to fix is the llm_clients in @packages/evals/ (were wrongfully commented out)

### Prompt 6

there's errors (tsc) on those 3 files hn_ custom openai langchain and aisdk

### Prompt 7

can I delete the entire dir then?

### Prompt 8

remove them

### Prompt 9

clean up properly

