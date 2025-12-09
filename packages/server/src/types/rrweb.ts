export interface Node {
  type: string;
  tagName?: string;
  attributes?: Record<string, string>;
  childNodes?: Node[];
  textContent?: string;
  id: number;
}

export interface Event {
  type: number;
  /*
  The data object is different for each event type
  but we're only accessing it when the data follows
  this structure, so we can just type this way.
  */
  data: { node: Node };
  sessionId?: string;
  timestamp: Date;
  actionId: string;
}
