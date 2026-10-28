import { returnControl, type Store } from "./state.js";
import type { Browser } from "./browser.js";
import type { Terminal } from "./terminal.js";

export async function returnFromHandoff(store: Store, browser: Browser, terminal: Terminal) {
  const state = await store.read();
  if (state.decision?.status !== "pending") return false;
  console.log(`Human step: ${state.decision.reason}`);
  await browser.liveLink();
  if (!terminal.enabled) {
    console.log(
      `After login: pnpm --filter stagehand-cookbook-libfx-receipts start return ${state.decision.id}`,
    );
    return false;
  }
  const answer = await terminal.choose(
    "Complete the human step in Live View, then Done / Pause > ",
    ["done"],
  );
  if (answer === "pause") return false;
  await store.update((draft) => {
    returnControl(draft, state.decision!.id);
  });
  return true;
}
