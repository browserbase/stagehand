import type { Protocol } from "devtools-protocol";
import { fillElementValue, prepareElementForTyping } from "../../dom/locatorScripts/scripts.js";
import { resolveLocatorWithHops } from "../../understudy/deepLocator.js";
import type { Page } from "../../understudy/page.js";
import type { Progress } from "../../understudy/progress.js";

// The closure lives in the isolated world for one CDP input command.
function watchFill(this: HTMLElement, expected: string) {
  const events = new AbortController();
  const root = this.getRootNode() as Document | ShadowRoot;
  const eventRoot = root instanceof ShadowRoot ? root : window;
  const focused = () => this.isConnected && root.activeElement === this;
  if (!focused()) return;
  let pending: Event | undefined;
  let received = false;
  let redirected = false;
  const before = (event: Event) => {
    if (!event.isTrusted) return;
    // Chrome may split one multiline insertion into several edits.
    if (pending?.defaultPrevented) redirected = true;
    pending = event;
    if (redirected || !focused() || event.composedPath()[0] !== this) {
      redirected = true;
      event.preventDefault();
    }
  };
  const options = { signal: events.signal };
  eventRoot.addEventListener("beforeinput", before, { ...options, capture: true });
  eventRoot.addEventListener("beforeinput", before, options);
  if (root instanceof ShadowRoot) {
    // A closed root hides the inner target from window listeners. Observe the
    // exact destination inside the root and block edits redirected outside it.
    window.addEventListener(
      "beforeinput",
      (event) => {
        if (event.isTrusted && !focused()) {
          redirected = true;
          event.preventDefault();
        }
      },
      { ...options, capture: true },
    );
  }
  // A target handler can stop propagation before the window bubble listener runs.
  this.addEventListener(
    "blur",
    () => {
      if (pending && pending.eventPhase !== Event.NONE) {
        redirected = true;
        pending.preventDefault();
      } else if (!received) {
        redirected = true;
      }
    },
    options,
  );
  eventRoot.addEventListener(
    "input",
    (event) => {
      if (!event.isTrusted) return;
      if (event.composedPath()[0] === this) received = true;
      else redirected = true;
    },
    { ...options, capture: true },
  );
  // Also expire if the debugger disconnects before releasing this handle.
  const timer = setTimeout(() => events.abort(), 30_000);
  return (verify: boolean) => {
    const active = !events.signal.aborted;
    events.abort();
    clearTimeout(timer);
    if (!active || !verify) return false;
    if (this instanceof HTMLInputElement && this.type === "email") {
      // Apply Chrome's email value sanitization without changing the live field.
      const native = document.createElement("input");
      native.type = "email";
      native.multiple = this.multiple;
      native.value = expected;
      expected = native.value;
    }
    const valueMatches =
      "value" in this
        ? this.value === expected
        : this.textContent === expected || this.innerText === expected;
    return (
      received && !redirected && !pending?.defaultPrevented && this.isConnected && valueMatches
    );
  };
}

export async function fillSelected(
  page: Page,
  selector: string,
  expectedId: string | undefined,
  value: string,
  progress: Progress,
): Promise<void> {
  const locator = await resolveLocatorWithHops(page, page.mainFrame(), selector, progress);
  const frame = locator.getFrame();
  const session = frame.session;
  const { objectId } = await locator.resolveNode(progress);
  const call = (id: string, fn: string, args: unknown[] = [], returnByValue = true) =>
    session.send<Protocol.Runtime.CallFunctionOnResponse>("Runtime.callFunctionOn", {
      objectId: id,
      functionDeclaration: fn,
      arguments: args.map((value) => ({ value })),
      returnByValue,
    });
  const release = (id: string) => session.send("Runtime.releaseObject", { objectId: id });
  const disposeWatcher = async (id: string) => {
    await progress.cleanup(() => call(id, "function () { this(false); }"));
    await progress.cleanup(() => release(id));
  };
  let watcher: string | undefined;
  try {
    if (expectedId) {
      const { node } = await progress.run("checking fill identity", () =>
        session.send<Protocol.DOM.DescribeNodeResponse>("DOM.describeNode", { objectId }),
      );
      if (`${page.getOrdinal(frame.frameId)}-${node.backendNodeId}` !== expectedId)
        throw new Error("fill_target_replaced");
    }
    const start = await progress.run("preparing fill", () =>
      call(objectId, fillElementValue.toString(), [value]),
    );
    if (start.result.value?.status === "done") {
      const checked = await progress.run("verifying native fill", () =>
        call(
          objectId,
          "function (expected) { return this.isConnected && this.value === expected; }",
          [value.trim()],
        ),
      );
      if (!checked.result.value) throw new Error("fill_value_unverified");
      return;
    }
    if (start.result.value?.status !== "needsinput" || start.result.value.reason)
      throw new Error("fill_preparation_failed");

    const text = start.result.value.value as string;
    if (text === "") {
      const empty = await progress.run("checking empty fill", () =>
        call(
          objectId,
          "function () { return this.isConnected && ('value' in this ? this.value : this.textContent) === ''; }",
        ),
      );
      if (empty.result.value === true) return;
    }
    const prepared = await progress.run("selecting text", () =>
      call(objectId, prepareElementForTyping.toString()),
    );
    if (prepared.result.value !== true) throw new Error("fill_preparation_failed");
    const guard = await progress.run(
      "checking fill focus",
      () => call(objectId, watchFill.toString(), [text], false),
      async (late) => {
        if (late.result.objectId) await disposeWatcher(late.result.objectId);
      },
    );
    watcher = guard.result.objectId;
    if (!watcher || guard.exceptionDetails) throw new Error("fill_focus_changed");

    if (text) {
      await progress.run("inserting selected text", () =>
        session.send("Input.insertText", { text }),
      );
    } else {
      const key = {
        key: "Backspace",
        code: "Backspace",
        windowsVirtualKeyCode: 8,
        nativeVirtualKeyCode: 8,
      };
      await progress.run("clearing selected text", async () => {
        try {
          await session.send("Input.dispatchKeyEvent", { ...key, type: "keyDown" });
        } finally {
          await progress.cleanup(() =>
            session.send("Input.dispatchKeyEvent", { ...key, type: "keyUp" }),
          );
        }
      });
    }
    const id = watcher;
    const verified = await progress.run("verifying fill destination", () =>
      call(id, "function () { return this(true); }"),
    );
    if (verified.result.value !== true) throw new Error("fill_input_unverified");
  } finally {
    if (watcher) await disposeWatcher(watcher);
    await progress.cleanup(() => release(objectId));
  }
}
