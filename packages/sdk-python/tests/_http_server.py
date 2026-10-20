from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager, suppress
from dataclasses import dataclass, field


@dataclass
class HTTPRequest:
    method: str
    path: str
    headers: dict[str, str]
    body: bytes
    disconnected: asyncio.Event = field(default_factory=asyncio.Event)


@asynccontextmanager
async def http_server(
    handle: Callable[[HTTPRequest, asyncio.StreamReader, asyncio.StreamWriter], Awaitable[None]],
    *,
    keep_alive: bool = False,
) -> AsyncIterator[str]:
    tasks: set[asyncio.Task[None]] = set()

    async def serve(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        requests: list[HTTPRequest] = []
        try:
            while not writer.is_closing():
                head = (await reader.readuntil(b"\r\n\r\n")).decode("latin-1")
                request_line, *header_lines = head.rstrip("\r\n").split("\r\n")
                method, path, _ = request_line.split(" ")
                headers = dict(line.split(":", 1) for line in header_lines)
                headers = {name.lower(): value.strip() for name, value in headers.items()}
                body = await reader.readexactly(int(headers.get("content-length", "0")))
                request = HTTPRequest(method, path, headers, body)
                requests.append(request)
                await handle(request, reader, writer)
                if not keep_alive:
                    break
        except (ConnectionError, asyncio.IncompleteReadError):
            pass
        finally:
            writer.close()
            with suppress(ConnectionError):
                await writer.wait_closed()
            for request in requests:
                request.disconnected.set()

    def accept(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        task = asyncio.create_task(serve(reader, writer))
        tasks.add(task)
        task.add_done_callback(tasks.discard)

    server = await asyncio.start_server(accept, "127.0.0.1", 0)
    try:
        yield f"http://127.0.0.1:{server.sockets[0].getsockname()[1]}"
    finally:
        server.close()
        await server.wait_closed()
        remaining = list(tasks)
        for task in remaining:
            task.cancel()
        await asyncio.gather(*remaining, return_exceptions=True)
