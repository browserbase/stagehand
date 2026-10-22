import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import {
  createRegistry,
  defineDoc,
  defineExtension,
  defineTool,
  Harness,
  section,
  type Storage,
} from "@earendil-works/pi-durable";
import { Browser } from "./browser.js";
import { initialState, type State, type Store } from "./state.js";
import { makeTools, instructions } from "./scenario.js";

export const Work = defineDoc<State>({
  kind: "cookbook.work",
  version: 1,
  scope: "conversation",
  history: "latest",
  fork: "initial",
  initial: initialState,
  checkpointWhen: () => true,
});

function defaultModels() {
  const models = createModels();
  models.setProvider(openaiProvider());
  return models;
}

export async function openAgent(storage: Storage, models = defaultModels()) {
  const registry = createRegistry();
  let harness: Harness;
  const store: Store = {
    async read() {
      const root = await harness.root(BACKGROUND_CONTEXT);
      return (await harness.snapshot(Work, root.id, BACKGROUND_CONTEXT)) ?? initialState();
    },
    async update(change) {
      const root = await harness.root(BACKGROUND_CONTEXT);
      await root.commit(async (tx) => {
        change(await tx.doc(Work, root.id));
      }, BACKGROUND_CONTEXT);
    },
  };
  const browser = new Browser(store);
  registry.install(
    defineExtension({
      name: "browser-cookbook",
      sections: [section("cookbook", () => instructions, { tag: false })],
      tools: makeTools(store, browser).map((tool) =>
        defineTool({
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
          replay: tool.replay === "safe" ? "safe" : "unsafe",
          executionMode: "sequential",
          execute: async (args, api) => {
            const result = await browser.serial(() =>
              tool.execute(args as Record<string, string>, String(api.taskId)),
            );
            return {
              ...(typeof result === "string"
                ? { output: [{ type: "text" as const, text: result }] }
                : result),
              ...((await store.read()).decision?.status === "pending"
                ? { control: { terminate: true as const } }
                : {}),
            };
          },
        }),
      ),
    }),
  );
  harness = await Harness.open(
    storage,
    {
      models,
      registry,
      settings: {
        toolExecution: "sequential",
        retry: { maxRetries: 0 },
        stream: { timeoutMs: 120_000 },
      },
    },
    BACKGROUND_CONTEXT,
  );
  return { harness, store, browser };
}

export { BACKGROUND_CONTEXT };
