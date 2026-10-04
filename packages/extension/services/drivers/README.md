# Drivers

`act()`, `observe()` and `extract()` each have one question at their core: which action, which
elements, which values. A **driver** answers it. The service around it owns everything else and
does not know how the answer was reached.

| Layer      | Owns                                                                 | Files                                                     |
| ---------- | -------------------------------------------------------------------- | --------------------------------------------------------- |
| Controller | Which drivers a call gets                                            | `controllers/stagehandController.ts`                      |
| Service    | Timeout, DOM settle, cache lookup and replay, usage, result envelope | `actService.ts`, `observeService.ts`, `extractService.ts` |
| Driver     | The decision                                                         | `drivers/llm/*`, `decisions/drivers.ts`                   |

## Contract

`types.ts` is the whole contract. A driver gets a request (the instruction, the page, the
configured model as an `LlmPort`, a timeout guard) and returns `resolved` or `abstained` with a
reason. It never throws to say "I am not sure", and a service never inspects which driver it has.

Three things in the act contract exist because drivers differ in more than the answer:

- `startsBeforeSettle`: a driver whose first step needs no page may run while the DOM settles.
  The service still settles first whenever a cache lookup is involved.
- `prepare()`: page-independent warm-up before the settle wait and the cache lookup.
- `ActHandoff`: what a driver that gave up leaves behind — actions that already ran, a shortlist
  the next driver may start from, and whether the result may still be cached.

## Composition

A chain is a driver. `fallback.ts` has the combinators:

```ts
actWithFallback(decisionsActDriver(config), llmActDriver()); // decision model first
actOrFail(decisionsActDriver(config)); // decision model only; abstaining fails the act
```

`index.ts` is the composition root, with the two bundles Stagehand ships:

```ts
llmDrivers(); // stagehand.act / observe / extract
decisionDrivers(config); // stagehand.experimentalDecisions.act / observe / extract
```

Each service takes its driver as a parameter and defaults to the language-model one, so a caller
that passes nothing gets the behaviour it always had.

## Adding or replacing a driver

Implement the interface, return it from a function, and either pass it to a service directly (as
`tests/drivers.test.ts` does with hand-written ones) or add a bundle next to `llmDrivers()`.
Nothing in the services changes.

```ts
const recorded: ActDriver = {
  name: "recorded",
  startsBeforeSettle: false,
  async resolve(request) {
    const action = lookUp(request.instruction);
    if (!action)
      return {
        kind: "abstained",
        reason: "not recorded",
        handoff: { priorActions: [], cacheable: true },
      };
    return {
      kind: "resolved",
      result: await request.runAction(action),
      path: "recorded",
      cacheable: true,
    };
  },
};

await actService.act({ ...call, driver: actWithFallback(recorded, llmActDriver()) });
```

## Shared pieces

- `actionRunner.ts`: performs an action on the page (variable substitution, the understudy call,
  one self-heal retry). Every driver acts through it, so an action behaves the same whoever chose
  it.
- `llmPort.ts`: the configured model plus a usage meter. Every driver in a chain records into the
  same meter, so reported usage is the whole operation's.
