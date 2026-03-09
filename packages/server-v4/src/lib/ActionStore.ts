import type {
  PageAction,
  PageActionStatus,
  PageActionMethod,
} from "../schemas/v4/page.js";

export interface ActionStoreListOptions {
  sessionId: string;
  pageId?: string;
  method?: PageActionMethod;
  status?: PageActionStatus;
  limit?: number;
}

export interface ActionStore {
  putAction(action: PageAction): Promise<void>;
  getAction(actionId: string): Promise<PageAction | null>;
  listActions(options: ActionStoreListOptions): Promise<PageAction[]>;
  destroy?(): Promise<void>;
}
