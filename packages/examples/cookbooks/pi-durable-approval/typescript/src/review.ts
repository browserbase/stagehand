import { approveOrder, decide, type Store } from "./state.js";
import type { Browser } from "./browser.js";
import type { Terminal } from "./terminal.js";

export async function reviewOrder(
  store: Store,
  browser: Pick<Browser, "liveLink" | "formValues">,
  terminal: Terminal,
) {
  let state = await store.read();
  if (!state.decision || !["pending", "approved"].includes(state.decision.status)) return false;
  await browser.liveLink();
  if (!terminal.enabled) {
    console.log(
      state.decision.status === "pending"
        ? `Approve: pnpm start approve ${state.decision.id}. Reject: pnpm start reject ${state.decision.id}`
        : `Submit in Live View, then: pnpm start return ${state.decision.id}`,
    );
    return false;
  }
  while (true) {
    state = await store.read();
    const decision = state.decision!;
    if (decision.status === "pending") {
      const answer = await terminal.choose(
        "Review the saved values in Live View. Approve / Reject / Pause > ",
        ["approve", "reject"],
      );
      if (answer === "pause") return false;
      if (answer === "reject") {
        await store.update((draft) => {
          decide(draft, decision.id, "rejected");
        });
        console.log("Rejected. Nothing was submitted.");
        return false;
      }
      const actual = await browser.formValues();
      try {
        await store.update((draft) => {
          approveOrder(draft, decision.id, actual);
        });
      } catch (error) {
        console.log(
          `Approval refused: ${error instanceof Error ? error.message : "invalid proposal"}. Restore the displayed values or pause.`,
        );
        continue;
      }
      console.log("Approved. Submit the reviewed form yourself in Live View.");
    } else if (decision.status === "approved") {
      const answer = await terminal.choose("After submitting in Live View, type Done / Pause > ", [
        "done",
      ]);
      if (answer === "pause") return false;
      await store.update((draft) => {
        decide(draft, decision.id, "returned");
      });
      return true;
    } else {
      return false;
    }
  }
}
