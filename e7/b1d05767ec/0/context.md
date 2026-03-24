# Session Context

## User Prompts

### Prompt 1

currently (after pr https://github.com/browserbase/stagehand/pull/1836) flowlogger is enabled by default on verbose:2. Can we change this to only enable when the env var BROWSERBASE_FLOW_LOGS=1 is set?

### Prompt 2

we need to run the tests. I just built manually

### Prompt 3

[Request interrupted by user for tool use]

### Prompt 4

we have another way to set env vars for tests don't we

### Prompt 5

flowlogger tests aren't passing on ci 
Search logs
1s
1s
16s
4s
- Expected
+ Received

- 1
+ 0

 ❯ tests/unit/flowlogger-eventstore.test.ts:127:20

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/4]⎯

 FAIL  dist/esm/tests/unit/flowlogger-eventstore.test.js > flow logger event store > renders generic stagehand events without crashing the stderr sink
AssertionError: expected [] to have a length of 1 but got +0

- Expected
+ Received

- 1
+ 0

 ❯ tests/unit/flowlog...

### Prompt 6

[Request interrupted by user for tool use]

### Prompt 7

what's the command to run all the flowlogger tests with the env var set

