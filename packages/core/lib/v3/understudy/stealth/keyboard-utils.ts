import { rand } from "./util";

const NEEDS_SHIFT = /[A-Z!@#$%^&*()_+{}|:"<>?~]/;
const IS_LETTER = /[a-zA-Z]/;
const IS_NUMBER = /[0-9]/;

type KeyMapping = {
  keyCode: string;
  virtualKeyCode: number;
};

// Map special chars to their key codes & virtual key codes
const KEY_MAPPINGS: Record<string, KeyMapping> = {
  " ": { keyCode: "Space", virtualKeyCode: 32 },
  "!": { keyCode: "Digit1", virtualKeyCode: 49 },
  "@": { keyCode: "Digit2", virtualKeyCode: 50 },
  "#": { keyCode: "Digit3", virtualKeyCode: 51 },
  $: { keyCode: "Digit4", virtualKeyCode: 52 },
  "%": { keyCode: "Digit5", virtualKeyCode: 53 },
  "^": { keyCode: "Digit6", virtualKeyCode: 54 },
  "&": { keyCode: "Digit7", virtualKeyCode: 55 },
  "*": { keyCode: "Digit8", virtualKeyCode: 56 },
  "(": { keyCode: "Digit9", virtualKeyCode: 57 },
  ")": { keyCode: "Digit0", virtualKeyCode: 48 },
  "-": { keyCode: "Minus", virtualKeyCode: 189 },
  _: { keyCode: "Minus", virtualKeyCode: 189 },
  "=": { keyCode: "Equal", virtualKeyCode: 187 },
  "+": { keyCode: "Equal", virtualKeyCode: 187 },
  "[": { keyCode: "BracketLeft", virtualKeyCode: 219 },
  "{": { keyCode: "BracketLeft", virtualKeyCode: 219 },
  "]": { keyCode: "BracketRight", virtualKeyCode: 221 },
  "}": { keyCode: "BracketRight", virtualKeyCode: 221 },
  "\\": { keyCode: "Backslash", virtualKeyCode: 220 },
  "|": { keyCode: "Backslash", virtualKeyCode: 220 },
  ";": { keyCode: "Semicolon", virtualKeyCode: 186 },
  ":": { keyCode: "Semicolon", virtualKeyCode: 186 },
  "'": { keyCode: "Quote", virtualKeyCode: 222 },
  '"': { keyCode: "Quote", virtualKeyCode: 222 },
  ",": { keyCode: "Comma", virtualKeyCode: 188 },
  "<": { keyCode: "Comma", virtualKeyCode: 188 },
  ".": { keyCode: "Period", virtualKeyCode: 190 },
  ">": { keyCode: "Period", virtualKeyCode: 190 },
  "/": { keyCode: "Slash", virtualKeyCode: 191 },
  "?": { keyCode: "Slash", virtualKeyCode: 191 },
  "`": { keyCode: "Backquote", virtualKeyCode: 192 },
  "~": { keyCode: "Backquote", virtualKeyCode: 192 },
};

// gets the "Unique DOM defined string value for each physical key"
export const getKeyCode = (char: string) => {
  if (char >= "0" && char <= "9") {
    return `Digit${char}`;
  }
  const lowercased = char.toLowerCase();
  if (lowercased >= "a" && lowercased <= "z") {
    return `Key${lowercased.toUpperCase()}`;
  }

  if (!KEY_MAPPINGS[char]) {
    throw new Error(`tried to type unknown char: ${char}`);
  }
  return KEY_MAPPINGS[char].keyCode;
};

// Gets the windowsVirtualKeyCode and nativeVirtualKeyCode (they seem to be the same?)
export const getVirtualKeyCode = (char: string) => {
  if (char >= "0" && char <= "9") {
    return char.charCodeAt(0);
  }
  const uppercased = char.toUpperCase();
  if (uppercased >= "A" && uppercased <= "Z") {
    return uppercased.charCodeAt(0);
  }

  return KEY_MAPPINGS[char]?.virtualKeyCode ?? char.charCodeAt(0);
};

// "Bit field representing pressed modifier keys. Alt=1, Ctrl=2, Meta/Command=4, Shift=8 (default: 0)."
export const getModifiersForChar = (char: string) => {
  if (NEEDS_SHIFT.test(char) || (char >= "A" && char <= "Z")) {
    return 8;
  }
  return undefined;
};

export const computeDelayForChar = (
  char: string,
  baseTypingDelayMin: number,
  baseTypingDelayMax: number,
  nextChar?: string,
) => {
  let delay = rand(baseTypingDelayMin, baseTypingDelayMax);
  // Add more delays based on what the user is typing

  if (NEEDS_SHIFT.test(char)) {
    delay += rand(50, 250);
  }

  if (nextChar && isSwitchingBetweenLetterAndNumber(char, nextChar)) {
    delay += rand(50, 100);
  }

  // Just throw a random delay in there cuz why not
  if (Math.random() < 0.2) {
    delay += rand(200, 600);
  }

  return delay;
};

const isSwitchingBetweenLetterAndNumber = (current: string, next: string) => {
  return (
    (IS_LETTER.test(current) && IS_NUMBER.test(next)) ||
    (IS_NUMBER.test(current) && IS_LETTER.test(next))
  );
};
