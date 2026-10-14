type KeyDescription = {
  key: string;
  code?: string;
  windowsVirtualKeyCode?: number;
  text?: string;
};

const ALIASES = new Map(
  Object.entries({
    win: "Meta",
    windows: "Meta",
    ctrl: "Control",
    control: "Control",
    option: "Alt",
    alt: "Alt",
    shift: "Shift",
    meta: "Meta",
    enter: "Enter",
    return: "Enter",
    esc: "Escape",
    escape: "Escape",
    backspace: "Backspace",
    tab: "Tab",
    space: " ",
    spacebar: " ",
    delete: "Delete",
    del: "Delete",
    left: "ArrowLeft",
    arrowleft: "ArrowLeft",
    right: "ArrowRight",
    arrowright: "ArrowRight",
    up: "ArrowUp",
    arrowup: "ArrowUp",
    down: "ArrowDown",
    arrowdown: "ArrowDown",
    home: "Home",
    end: "End",
    pageup: "PageUp",
    pgup: "PageUp",
    pagedown: "PageDown",
    pgdn: "PageDown",
  }),
);

const NAMED_KEYS = new Map<string, [code: string, vk: number]>([
  ["Enter", ["Enter", 13]],
  ["Tab", ["Tab", 9]],
  ["Backspace", ["Backspace", 8]],
  ["Escape", ["Escape", 27]],
  ["Delete", ["Delete", 46]],
  ["ArrowLeft", ["ArrowLeft", 37]],
  ["ArrowUp", ["ArrowUp", 38]],
  ["ArrowRight", ["ArrowRight", 39]],
  ["ArrowDown", ["ArrowDown", 40]],
  ["Home", ["Home", 36]],
  ["End", ["End", 35]],
  ["PageUp", ["PageUp", 33]],
  ["PageDown", ["PageDown", 34]],
  ["Alt", ["AltLeft", 18]],
  ["Control", ["ControlLeft", 17]],
  ["Meta", ["MetaLeft", 91]],
  ["Shift", ["ShiftLeft", 16]],
]);

// Physical US-layout codes, never ASCII-derived VKs: '.' must not become Delete (46).
const PRINTABLE_KEYS: Array<[plain: string, shifted: string, code: string, vk: number]> = [
  [" ", " ", "Space", 32],
  ["`", "~", "Backquote", 192],
  ["-", "_", "Minus", 189],
  ["=", "+", "Equal", 187],
  ["[", "{", "BracketLeft", 219],
  ["]", "}", "BracketRight", 221],
  ["\\", "|", "Backslash", 220],
  [";", ":", "Semicolon", 186],
  ["'", '"', "Quote", 222],
  [",", "<", "Comma", 188],
  [".", ">", "Period", 190],
  ["/", "?", "Slash", 191],
  ..."1234567890"
    .split("")
    .map((digit, index): [string, string, string, number] => [
      digit,
      "!@#$%^&*()"[index],
      `Digit${digit}`,
      digit.charCodeAt(0),
    ]),
];

const MODIFIERS = new Map(Object.entries({ Alt: 1, Control: 2, Meta: 4, Shift: 8 }));
export function modifierBit(key: string): number {
  return MODIFIERS.get(key) ?? 0;
}

function isMacOS(): boolean {
  return /mac|iphone|ipad|ipod/iu.test(globalThis.navigator?.platform ?? "");
}

export function describeKey(input: string, modifiers: number): KeyDescription {
  const lower = input.toLowerCase();
  const key = ["cmd", "command", "controlormeta"].includes(lower)
    ? isMacOS()
      ? "Meta"
      : "Control"
    : (ALIASES.get(lower) ?? input);
  const named = NAMED_KEYS.get(key);
  if (named) {
    return {
      key,
      code: named[0],
      windowsVirtualKeyCode: named[1],
      ...(key === "Enter" ? { text: "\r" } : {}),
    };
  }
  if (/^[a-zA-Z]$/.test(key)) {
    const upper = key.toUpperCase();
    const printable = modifiers & 8 ? upper : modifiers & 7 ? key.toLowerCase() : key;
    return {
      key: printable,
      code: `Key${upper}`,
      windowsVirtualKeyCode: upper.charCodeAt(0),
      text: printable,
    };
  }
  const physical = PRINTABLE_KEYS.find(([plain, shifted]) => key === plain || key === shifted);
  if (physical) {
    const [plain, shifted, code, vk] = physical;
    const printable = modifiers & 8 && key === plain ? shifted : key;
    return { key: printable, code, windowsVirtualKeyCode: vk, text: printable };
  }
  return { key, ...(/^.$/u.test(key) ? { text: key } : {}) };
}

export function macCommands(code: string | undefined, modifiers: number): { commands?: string[] } {
  if (!isMacOS() || modifiers !== 4 || !code) return {};
  const commands = new Map(
    Object.entries({
      KeyA: "selectAll",
      KeyC: "copy",
      KeyX: "cut",
      KeyV: "paste",
      KeyZ: "undo",
    }),
  );
  const command = commands.get(code);
  return command ? { commands: [command] } : {};
}
