import { describe, expect, it } from "vitest";
import { V3Context } from "../../lib/v3/understudy/context.js";

describe("V3Context proxy credentials", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const privateCtor = V3Context.prototype.constructor as any;

  it("stores credentials when proxy.username and proxy.password are set", () => {
    const instance = new privateCtor({}, "LOCAL", null, {
      proxy: {
        server: "http://proxy.example.com:8080",
        username: "user",
        password: "pass",
      },
    });

    expect(instance.proxyCredentials).toEqual({
      username: "user",
      password: "pass",
    });
  });

  it("does not store credentials when username/password are missing", () => {
    const instance = new privateCtor({}, "LOCAL", null, {
      proxy: { server: "http://proxy.example.com:8080" },
    });

    expect(instance.proxyCredentials).toBeNull();
  });

  it("does not store credentials when no proxy is configured", () => {
    const noProxy = new privateCtor({}, "LOCAL", null, {});
    expect(noProxy.proxyCredentials).toBeNull();

    const nullLbo = new privateCtor({}, "LOCAL", null, null);
    expect(nullLbo.proxyCredentials).toBeNull();
  });
});
