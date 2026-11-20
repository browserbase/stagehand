import type { Protocol } from "devtools-protocol";
import type { CDPSessionLike } from "./cdp.js";
import { describeKey, macCommands, modifierBit } from "./keyboardLayout.js";
import { type Progress, runLocatorStep } from "./progress.js";

/** Owns a page's held keys. Dispatch and state updates share one ordered queue. */
export class Keyboard {
  private readonly pressed = new Map<string, number>();
  private pending: Promise<void> = Promise.resolve();

  constructor(private readonly session: CDPSessionLike) {}

  get modifiers(): number {
    let mask = 0;
    for (const bit of this.pressed.values()) mask |= bit;
    return mask;
  }

  down(key: string): Promise<void> {
    return this.enqueue(() => this.dispatchDown(key));
  }

  up(key: string): Promise<void> {
    return this.enqueue(() => this.dispatchUp(key));
  }

  press(key: string, options?: { delay?: number }, progress?: Progress): Promise<void> {
    const result = this.enqueue(async () => {
      const acquired: string[] = [];
      try {
        for (const token of splitChord(key)) {
          progress?.throwIfStopped();
          const description = describeKey(token, this.modifiers);
          const held = this.pressed.has(description.code ?? description.key);
          if (held && modifierBit(description.key)) continue;
          if (!held) acquired.push(token);
          await this.dispatchDown(token);
        }
        const delay = Math.max(0, options?.delay ?? 0);
        if (delay) {
          if (progress) await progress.delay(delay);
          else await new Promise<void>((resolve) => setTimeout(resolve, delay));
        }
        while (acquired.length) {
          progress?.throwIfStopped();
          await this.dispatchUp(acquired.at(-1)!);
          acquired.pop();
        }
      } catch (error) {
        // Only release keys this chord acquired; caller-held keys must survive.
        // Awaiting dispatches also keeps late CDP responses ahead of cleanup.
        for (const token of acquired.reverse()) {
          await this.dispatchUp(token).catch(() => {});
        }
        throw error;
      }
    });
    return runLocatorStep(progress, "pressing keys", () => result);
  }

  private enqueue(work: () => Promise<void>): Promise<void> {
    const result = this.pending.then(work);
    this.pending = result.catch(() => {});
    return result;
  }

  private async dispatchDown(key: string): Promise<void> {
    const { text, ...description } = describeKey(key, this.modifiers);
    const identity = description.code ?? description.key;
    const bit = modifierBit(description.key);
    const modifiers = this.modifiers | bit;
    const input = modifiers & 7 ? undefined : text;
    const event: Protocol.Input.DispatchKeyEventRequest = {
      type: input ? "keyDown" : "rawKeyDown",
      ...description,
      modifiers,
      autoRepeat: this.pressed.has(identity),
      ...(input ? { text: input, unmodifiedText: input } : {}),
      ...macCommands(description.code, modifiers),
    };
    await this.session.send("Input.dispatchKeyEvent", event);
    this.pressed.set(identity, bit);
  }

  private async dispatchUp(key: string): Promise<void> {
    const { text: _text, ...description } = describeKey(key, this.modifiers);
    const identity = description.code ?? description.key;
    const event: Protocol.Input.DispatchKeyEventRequest = {
      type: "keyUp",
      ...description,
      modifiers: this.modifiers & ~modifierBit(description.key),
    };
    await this.session.send("Input.dispatchKeyEvent", event);
    this.pressed.delete(identity);
  }
}

/** Preserve literal '+' both alone and at the end of a chord (Control++). */
function splitChord(chord: string): string[] {
  const tokens: string[] = [];
  let token = "";
  for (const char of chord) {
    if (char === "+" && token) {
      tokens.push(token);
      token = "";
    } else token += char;
  }
  if (token) tokens.push(token);
  return tokens;
}
