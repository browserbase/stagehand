import type { Protocol } from "devtools-protocol";
import type { Page } from "./page";

export type NetworkListener = (message: NetworkMessage) => void;

export type NetworkMessageType = "request" | "response";

export interface NetworkMessageData {
  type: NetworkMessageType;
  requestId: string;
  frameId?: string;
  loaderId?: string;
  url: string;
  method?: string;
  resourceType?: Protocol.Network.ResourceType;
  timestamp: number;
  // Request-specific fields
  requestHeaders?: Protocol.Network.Headers;
  postData?: string;
  // Response-specific fields
  status?: number;
  statusText?: string;
  responseHeaders?: Protocol.Network.Headers;
  mimeType?: string;
  fromCache?: boolean;
  fromServiceWorker?: boolean;
}

/**
 * NetworkMessage
 *
 * Represents a network request or response message captured via CDP.
 * Similar to ConsoleMessage, this provides a convenient wrapper around
 * the raw CDP events for network activity.
 */
export class NetworkMessage {
  private readonly data: NetworkMessageData;
  private readonly pageRef?: Page;

  constructor(data: NetworkMessageData, pageRef?: Page) {
    this.data = data;
    this.pageRef = pageRef;
  }

  /**
   * Returns the type of network event: "request" or "response"
   */
  type(): NetworkMessageType {
    return this.data.type;
  }

  /**
   * Returns the unique request identifier
   */
  requestId(): string {
    return this.data.requestId;
  }

  /**
   * Returns the frame ID associated with this network event
   */
  frameId(): string | undefined {
    return this.data.frameId;
  }

  /**
   * Returns the loader ID associated with this network event
   */
  loaderId(): string | undefined {
    return this.data.loaderId;
  }

  /**
   * Returns the URL of the request
   */
  url(): string {
    return this.data.url;
  }

  /**
   * Returns the HTTP method (GET, POST, etc.)
   */
  method(): string | undefined {
    return this.data.method;
  }

  /**
   * Returns the resource type (Document, Stylesheet, Image, etc.)
   */
  resourceType(): Protocol.Network.ResourceType | undefined {
    return this.data.resourceType;
  }

  /**
   * Returns the timestamp when the event occurred
   */
  timestamp(): number {
    return this.data.timestamp;
  }

  /**
   * Returns the request headers (if available)
   */
  requestHeaders(): Protocol.Network.Headers | undefined {
    return this.data.requestHeaders;
  }

  /**
   * Returns the POST data (if available for requests)
   */
  postData(): string | undefined {
    return this.data.postData;
  }

  /**
   * Returns the HTTP status code (for responses)
   */
  status(): number | undefined {
    return this.data.status;
  }

  /**
   * Returns the HTTP status text (for responses)
   */
  statusText(): string | undefined {
    return this.data.statusText;
  }

  /**
   * Returns the response headers (if available)
   */
  responseHeaders(): Protocol.Network.Headers | undefined {
    return this.data.responseHeaders;
  }

  /**
   * Returns the MIME type (for responses)
   */
  mimeType(): string | undefined {
    return this.data.mimeType;
  }

  /**
   * Returns whether the response was served from cache
   */
  fromCache(): boolean {
    return this.data.fromCache ?? false;
  }

  /**
   * Returns whether the response was served from a service worker
   */
  fromServiceWorker(): boolean {
    return this.data.fromServiceWorker ?? false;
  }

  /**
   * Returns the Page that owns this network message
   */
  page(): Page | undefined {
    return this.pageRef;
  }

  /**
   * Returns the raw event data
   */
  raw(): NetworkMessageData {
    return { ...this.data };
  }

  /**
   * Returns a string representation of the network message
   */
  toString(): string {
    if (this.data.type === "request") {
      return `[Request] ${this.data.method ?? "GET"} ${this.data.url}`;
    } else {
      return `[Response] ${this.data.status ?? "???"} ${this.data.url}`;
    }
  }
}
