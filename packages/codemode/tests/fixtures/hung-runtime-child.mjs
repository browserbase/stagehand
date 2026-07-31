process.on("message", (request) => {
  if (request.type === "configure") {
    process.send?.({ id: request.id, ok: true });
    return;
  }
  if (request.type === "run" && request.code === "hang") {
    while (true) {
      // Deliberately block this process's event loop. The parent watchdog must
      // remain able to terminate it.
    }
  }
  if (request.type === "run" && request.code === "child-timeout") {
    process.send?.({
      id: request.id,
      ok: false,
      error: {
        name: "CodeExecutionTimeoutError",
        message: "child timer fired",
        kind: "timeout",
        retryable: false,
        mayHaveSideEffects: true,
      },
    });
    setTimeout(() => process.exit(1), 1_000);
    return;
  }
  if (request.type === "run" && request.code === "crash") {
    process.exit(1);
  }
  if (request.type === "run") {
    process.send?.({
      id: request.id,
      ok: true,
      result: {
        value: "recovered",
        logs: [],
        page: { url: "about:blank", title: "" },
      },
    });
    return;
  }
  if (request.type === "close") {
    process.send?.({ id: request.id, ok: true, result: { closed: true } });
    setImmediate(() => process.exit(0));
  }
});
