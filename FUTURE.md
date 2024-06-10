The purpose of this doc is to discuss future directions and plans for stagehand. To see actionable improvements, refer to the repo's issues.

## Vision

The main thing people ask about with regards to stagehand is the lack of vision. Vision would unlock 2 major wins

1. the LLM will use the visual layout to improve context
2. instructions can reference visual positioning in instructions

The challenge is to create an effective map between elements, and the screenshots. Fuji-web does this by supplying a regular screenshot and an annotated one in order to access the element map correctly.

Ultimately the question is by how much will this improve accuracy, and is it worth the cost latency trade off.

## Playwright

Stagehand currently depends on playwright. Is that a good thing? There are a couple of major benefits

1. LLMs can already write atomic playwright instructions really well
2. Using playwright de-risks a lot of flakiness around interacting with the web

[Garret](https://github.com/GRVYDEV) brought up an interesting point, that if instead stagehand could work with sort of a "browser automation assembly" we might be able to do more interesting things when it comes to a interactive workflow. It would also give stagehand a lot more flexibility in interacting with other projets like Langchain. However, I think an advantage of stagehand is that it will focus on the reliability of these atomic actions and will allow higher level code to avoid thinking about these things.

## Caching

LLMs are still expensive, and for automations that run many times on pages that rarely change, it is extremely wasteful to talk to an LLM every time. V0 of stagehand implemented caching that would rollback and retry if instructions failed. This is currently disabled until we learn more about how people want to use the library, and what kind of instructions are cachable in reality.

A good middle ground might be to make instructions cachability opt in.

Also, the initial implementation of caching was pretty lax. if the instruction didn't error things would proceed. However, that doesn't mean everything worked as expected. Instead, we could use the list of candidate elements as a sort of key for the cache. Even if the overall structure changed, if the same candidate elements are there required to do the thing, we can do the thing without talking to an LLM.

## Levels of abstraction

One thing we still haven't nailed is what the right level of abstraction is for this library. The opportunity is we get to define it! By talking to devs who are relying on automation for their product to truly work, we can uncover what is valuable to them in terms of effort saved while still being reliable. TLDR, talk to customers and make the product better.

## Environments

Python is clearly the next best place to support stagehand. Is there any value to making this runnable in the browser?
