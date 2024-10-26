The purpose of this doc is to discuss future directions and plans for stagehand. To see actionable improvements, refer to the repo's issues.

## Improvements to Vision

~~The main thing people ask about with regards to stagehand is the lack of vision. Vision would unlock 2 major wins~~~

1. ~~the LLM will use the visual layout to improve context~~
2. ~~instructions can reference visual positioning in instructions~~

~~The challenge is to create an effective map between elements, and the screenshots. Fuji-web does this by supplying a regular screenshot and an annotated one in order to access the element map correctly.~~

We have a baseline implementation of the vision mechanism done. 

Improvement suggestions:

- Reduce the size of the vision model for optimized and fast performance. <br> Example to incorporate: https://github.com/merveenoyan/smol-vision

Ultimately the question is by how much will this improve accuracy, and is it worth the cost latency trade off.

## Playwright

Stagehand currently depends on playwright. Is that a good thing? There are a couple of major benefits

1. LLMs can already write atomic playwright instructions really well
2. Using playwright de-risks a lot of flakiness around interacting with the web

[Garret](https://github.com/GRVYDEV) brought up an interesting point, that if instead stagehand could work with sort of a "browser automation assembly" we might be able to do more interesting things when it comes to a interactive workflow. It would also give stagehand a lot more flexibility in interacting with other projets like Langchain. However, I think an advantage of stagehand is that it will focus on the reliability of these atomic actions and will allow higher level code to avoid thinking about these things.

## Caching

LLMs are still expensive, and for automations that run many times on pages that rarely change, it is extremely wasteful to talk to an LLM every time. V0 of stagehand implemented caching that would rollback and retry if instructions failed. This is currently disabled until we learn more about how people want to use the library, and what kind of instructions are cachable in reality.

Reducing LLM calls where possible by hashing previous element maps on websites which have been visited can greatly increase speed and reduce cost of the library. There needs to be a mechanism to check for page updates, though (maybe some fuzzy DOM hash similarity metric)

A good middle ground might be to make instructions cachability opt in.

Also, the initial implementation of caching was pretty lax. if the instruction didn't error things would proceed. However, that doesn't mean everything worked as expected. Instead, we could use the list of candidate elements as a sort of key for the cache. Even if the overall structure changed, if the same candidate elements are there required to do the thing, we can do the thing without talking to an LLM.

## Latency & Performance & Cost

The current library is not optimized for performance, latency and cost yet.
`stagehand` should be very cheap to run and ideally very fast so that it can be a highly scalable AI agent web automation framework.

Here is a non-exhaustive list of thoughts / missing pieces to improve on this:

- DOM parsing is cheaper than vision. The library should be optimized to leverage DOM parsing as much as possible before falling back on vision for cost optimization.
- When using vision, can we optimize by reducing the size of the image so that it's barely visible to a human eye, but large enough for an llm to create a cheap element map? See [Improvements to vision](#improvements-to-vision)
- See [Caching](#caching) section above for details on reducing LLM calls through element map hashing and cache invalidation strategies.
- Recursion / Tree traversal improvements: many ideas here, we sometimes go really deep in the recursion stack unneccesarily, maybe some "look ahead" mechanism when drilling deeper in the DOM could be explored.
- Node pruning: prune more nodes based on the user query vs text or other representation of the node in the DOM tree
- Combining i-frames with clickable elements. Right now, if the element we seek is in i-frame which is not the main frame, we try to traverse all chunks in the mainframe first. It would be therefore way more efficient to have a mechanism to feed all possible elements into one LLM call from all i-frames (of course, we will have to handle infinite scrolling edge cases etc.)
- Chunking improvements - can we use a fast algorithm to get text from all top-level nodes and then based on the user query jump directly to the chunk desired? This could greatly increase the processing speed.
- Parallel processing of chunks: this one is obvious, but when searching for info in different chunk in parallel, we need to deal with locks when merging the information found in separate processes.

## Open Source Models

It would be great if `stagehand` could support open-source models as well as local or "in-browser" LLMs which could run server-side when running massive parallel jobs. (Is it possible to inject pure C/java LLM code implementation into a browser and use client side compute when running headless (client from the purview of owner of the stagehand job and that being the server)? Like a small 1-2B param quantized model which could run DOM segmentation tasks quite efficiently)

## Levels of abstraction

One thing we still haven't nailed is what the right level of abstraction is for this library. The opportunity is we get to define it! By talking to devs who are relying on automation for their product to truly work, we can uncover what is valuable to them in terms of effort saved while still being reliable. TLDR, talk to customers and make the product better.

## Environments

Python is clearly the next best place to support stagehand. Is there any value to making this runnable in the browser?
