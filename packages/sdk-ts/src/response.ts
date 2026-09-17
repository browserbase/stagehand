import type {
  NavigationHeader,
  NavigationResponseDescriptor,
  NavigationSecurityDetails,
  NavigationServerAddr,
} from "@browserbasehq/stagehand-protocol/types";
import { StagehandMethods } from "@browserbasehq/stagehand-protocol/schema-registry";
import { decodeBase64 } from "./base64.js";
import type { StagehandCommandClient } from "./commandClient.js";

export type ResponseHeader = NavigationHeader;
export type ResponseSecurityDetails = NavigationSecurityDetails;
export type ResponseServerAddr = NavigationServerAddr;

export class Response {
  readonly #rpcClient: StagehandCommandClient;
  readonly #descriptor: NavigationResponseDescriptor;

  constructor(rpcClient: StagehandCommandClient, descriptor: NavigationResponseDescriptor) {
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
    return decodeBase64(result.body, "response.body");
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
