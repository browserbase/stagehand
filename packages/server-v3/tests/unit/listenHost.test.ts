import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ALL_INTERFACES_LISTEN_HOST,
  DEFAULT_LISTEN_HOST,
  getListenHostConfig,
} from "../../src/lib/listenHost.js";

describe("getListenHostConfig", () => {
  it("defaults to localhost when HOST is not provided", () => {
    assert.deepEqual(getListenHostConfig(undefined), {
      host: DEFAULT_LISTEN_HOST,
    });
  });

  it("defaults to localhost when HOST is blank", () => {
    assert.deepEqual(getListenHostConfig("  "), {
      host: DEFAULT_LISTEN_HOST,
    });
  });

  it("respects explicit localhost host values", () => {
    assert.deepEqual(getListenHostConfig("localhost"), {
      host: "localhost",
    });
    assert.deepEqual(getListenHostConfig("127.0.0.1"), {
      host: "127.0.0.1",
    });
  });

  it("warns when HOST explicitly requests all interfaces", () => {
    const config = getListenHostConfig(ALL_INTERFACES_LISTEN_HOST);

    assert.equal(config.host, ALL_INTERFACES_LISTEN_HOST);
    assert.match(config.warning ?? "", /listen on all network interfaces/);
  });
});
