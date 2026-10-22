import assert from "node:assert/strict";
import { test } from "node:test";
import { PassThrough, Writable } from "node:stream";
import { Terminal } from "../src/terminal.js";

void test("terminal preserves buffered answers and reprompts on invalid input", async () => {
  const input = new PassThrough();
  let output = "";
  const terminal = new Terminal({
    enabled: true,
    input,
    output: new Writable({
      write(chunk, _encoding, done) {
        output += chunk.toString();
        done();
      },
    }),
  });
  try {
    input.end("invalid\nAPPROVE\ndone\n");
    assert.equal(await terminal.choose("Approve > ", ["approve", "reject"]), "approve");
    assert.equal(await terminal.choose("Done > ", ["done"]), "done");
    assert.equal(await terminal.choose("Done > ", ["done"]), "pause");
    assert.match(output, /Enter approve, reject, pause/);
  } finally {
    terminal.close();
  }
});

void test("closing the terminal releases a pending human wait without granting consent", async () => {
  const input = new PassThrough();
  const terminal = new Terminal({ enabled: true, input, output: new PassThrough() });
  const waiting = terminal.choose("Approve > ", ["approve", "reject"]);
  terminal.close();
  assert.equal(await waiting, "pause");
});
