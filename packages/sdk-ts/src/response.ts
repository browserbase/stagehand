import type {
  NavigationHeader,
  NavigationResponseDescriptor,
  NavigationSecurityDetails,
  NavigationServerAddr,
} from "../../protocol/types.js";
import { StagehandMethods } from "../../protocol/schema-registry.js";
import type { RPCClient } from "./rpcClient.js";

export type ResponseHeader = NavigationHeader;
export type ResponseSecurityDetails = NavigationSecurityDetails;
export type ResponseServerAddr = NavigationServerAddr;

const BASE64_PATTERN = /^(?:[A-Za-z\d+/]{4})*(?:[A-Za-z\d+/]{2}==|[A-Za-z\d+/]{3}=)?$/;

export class Response {
  readonly #rpcClient: RPCClient;
  readonly #descriptor: NavigationResponseDescriptor;

  constructor(rpcClient: RPCClient, descriptor: NavigationResponseDescriptor) {
    this.#rpcClient = rpcClient;
    this.#descriptor = {
      ...descriptor,
      headers: { ...descriptor.headers },
    };
  }

  url(): string {
    return this.#descriptor.url;
  }

  status(): number {
    return this.#descriptor.status;
  }

  statusText(): string {
    return this.#descriptor.statusText;
  }

  ok(): boolean {
    return this.status() >= 200 && this.status() <= 299;
  }

  headers(): Record<string, string> {
    return { ...this.#descriptor.headers };
  }

  async allHeaders(): Promise<Record<string, string>> {
    const result = await this.#rpcClient.send(StagehandMethods.responseAllHeaders, {
      responseId: this.#descriptor.responseId,
    });
    return { ...result.headers };
  }

  async headerValue(name: string): Promise<string | null> {
    const values = await this.headerValues(name);
    return values.length === 0 ? null : values.join(", ");
  }

  async headerValues(name: string): Promise<string[]> {
    const normalizedName = name.toLowerCase();
    const headers = await this.headersArray();
    return headers
      .filter((header) => header.name.toLowerCase() === normalizedName)
      .map((header) => header.value);
  }

  async headersArray(): Promise<ResponseHeader[]> {
    const result = await this.#rpcClient.send(StagehandMethods.responseHeadersArray, {
      responseId: this.#descriptor.responseId,
    });
    return result.headers.map((header) => ({ ...header }));
  }

  fromServiceWorker(): boolean {
    return this.#descriptor.fromServiceWorker;
  }

  async securityDetails(): Promise<ResponseSecurityDetails | null> {
    const result = await this.#rpcClient.send(StagehandMethods.responseSecurityDetails, {
      responseId: this.#descriptor.responseId,
    });
    return result.value === null ? null : { ...result.value };
  }

  async serverAddr(): Promise<ResponseServerAddr | null> {
    const result = await this.#rpcClient.send(StagehandMethods.responseServerAddr, {
      responseId: this.#descriptor.responseId,
    });
    return result.value === null ? null : { ...result.value };
  }

  async body(): Promise<Uint8Array> {
    const result = await this.#rpcClient.send(StagehandMethods.responseBody, {
      responseId: this.#descriptor.responseId,
    });
    return decodeBase64(result.body);
  }

  async text(): Promise<string> {
    return new TextDecoder().decode(await this.body());
  }

  async json<T = unknown>(): Promise<T> {
    return JSON.parse(await this.text()) as T;
  }

  async finished(): Promise<null | Error> {
    const result = await this.#rpcClient.send(StagehandMethods.responseFinished, {
      responseId: this.#descriptor.responseId,
    });
    return result.error === null ? null : new Error(result.error.message);
  }
}

function decodeBase64(value: string): Uint8Array {
  if (value.length % 4 !== 0 || !BASE64_PATTERN.test(value)) {
    throw new Error("response.body returned invalid base64");
  }

  let binary: string;
  try {
    binary = globalThis.atob(value);
  } catch {
    throw new Error("response.body returned invalid base64");
  }
  if (globalThis.btoa(binary) !== value) {
    throw new Error("response.body returned invalid base64");
  }

  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}
