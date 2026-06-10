import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";

export interface CapturedRequest {
  method: string;
  path: string;
  headers: IncomingMessage["headers"];
  bodyBuffer: Buffer;
  bodyText: string;
  jsonBody?: unknown;
}

export interface FakeBrowserbaseServer {
  baseUrl: string;
  requests: CapturedRequest[];
  close(): Promise<void>;
}

export async function startFakeBrowserbaseServer(
  handler: (
    request: CapturedRequest,
    response: ServerResponse,
  ) => Promise<void> | void,
): Promise<FakeBrowserbaseServer> {
  const requests: CapturedRequest[] = [];
  const server = createServer(async (request, response) => {
    const bodyBuffer = await readBody(request);
    const bodyText = bodyBuffer.toString("utf8");

    let jsonBody: unknown;
    if (bodyText) {
      try {
        jsonBody = JSON.parse(bodyText);
      } catch {
        jsonBody = undefined;
      }
    }

    const captured: CapturedRequest = {
      method: request.method ?? "GET",
      path: request.url ?? "/",
      headers: request.headers,
      bodyBuffer,
      bodyText,
      jsonBody,
    };
    requests.push(captured);

    await handler(captured, response);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
  };
}

async function readBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export function jsonResponse(
  response: ServerResponse,
  statusCode: number,
  body: unknown,
): void {
  response.writeHead(statusCode, {
    "content-type": "application/json",
  });
  response.end(JSON.stringify(body));
}

export function textResponse(
  response: ServerResponse,
  statusCode: number,
  body: string,
): void {
  response.writeHead(statusCode, {
    "content-type": "text/plain",
  });
  response.end(body);
}

export function binaryResponse(
  response: ServerResponse,
  statusCode: number,
  body: Buffer,
  contentType = "application/octet-stream",
): void {
  response.writeHead(statusCode, {
    "content-type": contentType,
  });
  response.end(body);
}
