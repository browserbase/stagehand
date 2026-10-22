import { decide, type Store } from "./state.js";
import type { Browser } from "./browser.js";
import type { Terminal } from "./terminal.js";

export async function reviewSubmission(
  store: Store,
  browser: Pick<Browser, "liveLink">,
  terminal: Terminal,
) {
  const state = await store.read();
  if (state.decision?.status !== "pending") return false;
  await browser.liveLink();
  if (!terminal.enabled) {
    console.log(
      `Approve: pnpm start approve ${state.decision.id}. Reject: pnpm start reject ${state.decision.id}`,
    );
    return false;
  }
  const answer = await terminal.choose(
    "Review the saved values in Live View. Approve / Reject / Pause > ",
    ["approve", "reject"],
  );
  if (answer === "pause") return false;
  await store.update((draft) => {
    decide(draft, state.decision!.id, answer === "approve" ? "approved" : "rejected");
  });
  console.log(
    answer === "approve"
      ? "Approved. Continuing with guarded submission and verification..."
      : "Rejected. Nothing was submitted.",
  );
  return answer === "approve";
}
