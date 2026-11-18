import { createRequire } from "node:module";
import { expect, vi } from "vitest";

export function fakeKeyring() {
  const require = createRequire(import.meta.url);
  const library = require("@napi-rs/keyring");
  const secrets = new Map<string, string>();
  const state = { unavailable: false, rejectDelete: false, rejectWrite: false };
  const constructor = vi.spyOn(library, "Entry").mockImplementation(function (
    service: string,
    account: string,
    options: unknown,
  ) {
    expect(service).toBe("com.browserbase.browse");
    expect(options).toEqual({ linux: { store: "secret-service" } });
    if (state.unavailable) throw new Error("unavailable");
    return {
      getPassword: () => secrets.get(account) ?? null,
      setPassword: (value: string) => {
        if (state.rejectWrite) throw new Error("locked");
        secrets.set(account, value);
      },
      deleteCredential: () => {
        if (state.rejectDelete) throw new Error("locked");
        return secrets.delete(account);
      },
    };
  });
  return { secrets, state, constructor };
}
