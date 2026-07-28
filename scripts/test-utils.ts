/** Shared helpers for test runner scripts. */
import fs from "node:fs";

export const splitArgs = (args: string[]) => {
  const tokens = [...args];
  while (tokens[0] === "--") {
    tokens.shift();
  }

  const leadingExtra: string[] = [];
  while (tokens.length > 0 && tokens[0].startsWith("-")) {
    const arg = tokens.shift();
    if (!arg) break;
    if (arg === "--") break;
    leadingExtra.push(arg);
    if (!arg.includes("=") && tokens[0] && tokens[0] !== "--" && !tokens[0].startsWith("-")) {
      leadingExtra.push(tokens.shift() as string);
    }
  }

  while (tokens[0] === "--") {
    tokens.shift();
  }

  const separatorIndex = tokens.indexOf("--");
  return {
    paths: separatorIndex === -1 ? tokens : tokens.slice(0, separatorIndex),
    extra: [...leadingExtra, ...(separatorIndex === -1 ? [] : tokens.slice(separatorIndex + 1))],
  };
};

export const parseListFlag = (args: string[]) => {
  const remaining: string[] = [];
  let value: string | null = null;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--list") {
      const next = args[i + 1];
      if (next && !next.startsWith("--")) {
        value = next;
        i += 1;
      } else {
        value = "";
      }
      continue;
    }
    if (arg.startsWith("--list=")) {
      value = arg.slice("--list=".length);
      continue;
    }
    remaining.push(arg);
  }
  return { list: value !== null, value: value ?? "", args: remaining };
};

export const toSafeName = (name: string) => name.replace(/[\\/]/g, "-");

export const collectFiles = (dir: string, suffix: string) => {
  const results: string[] = [];
  const walk = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = `${current}/${entry.name}`;
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && entry.name.endsWith(suffix)) {
        results.push(full);
      }
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return results.sort();
};
