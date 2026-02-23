import type { Protocol } from "devtools-protocol";

export interface SerializableResponse {
  requestId: string;
  frameId?: string;
  loaderId?: string;
  response: Protocol.Network.Response;
  fromServiceWorkerFlag?: boolean;
  finishedSettled?: boolean;
  extraInfoHeaders?: Protocol.Network.Headers | null;
  extraInfoHeadersText?: string;
}
