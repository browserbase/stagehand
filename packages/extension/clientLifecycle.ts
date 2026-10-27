import { z } from "zod/v4";
import type { CdpConnection } from "./understudy/cdp.js";

// The SDK creates this hidden target on its own CDP session. Chrome destroys it
// when that session ends, independently of the SDK's event loop or signal handlers.
export const CLIENT_TARGET_URL = "about:blank#stagehand-client-connection";

const AttachSchema = z.strictObject({
  action: z.literal("attach"),
  targetId: z.string().min(1),
  cdpUrl: z.string().min(1),
  closeBrowserOnDisconnect: z.boolean(),
});
const DetachSchema = z.strictObject({
  action: z.literal("detach"),
  targetId: z.string().min(1),
});
const RequestSchema = z.discriminatedUnion("action", [AttachSchema, DetachSchema]);

type Attachment = {
  targetId: string;
  connection: CdpConnection;
  closeBrowserOnDisconnect: boolean;
  onDestroyed: (event: { targetId: string }) => void;
};

/** Browser-side ownership of one SDK attachment. No heartbeat or expiry timer. */
export class ClientLifecycle {
  private attachment?: Attachment;
  private tail: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly options: {
      connection(cdpUrl: string): Promise<CdpConnection>;
      releaseClient(): Promise<void>;
      closeConnection(): Promise<void>;
      onError(error: unknown): void;
    },
  ) {}

  handle(input: unknown): Promise<void> {
    const request = RequestSchema.parse(input);
    return this.enqueue(async () => {
      if (request.action === "detach") {
        if (this.attachment?.targetId !== request.targetId) {
          throw new Error("Stagehand client attachment is no longer active");
        }
        // Disarm before closing B or allowing A to close. A failed cleanup must
        // never turn an intentional detach into an instruction to kill Chrome.
        this.removeAttachment();
        await this.options.releaseClient();
        await this.options.closeConnection();
        return;
      }
      if (this.attachment) {
        const previous = this.attachment;
        const targets = await previous.connection.getTargets();
        if (targets.some((target) => target.targetId === previous.targetId)) {
          throw new Error("A Stagehand client is already connected");
        }
        // Target destruction and a new client's registration can arrive on
        // different transports. Reconcile before rejecting a legitimate reconnect.
        await this.lost(previous);
      }
      const connection = await this.options.connection(request.cdpUrl);
      const attachment: Attachment = {
        ...request,
        connection,
        onDestroyed: ({ targetId }) => {
          if (targetId !== request.targetId) return;
          void this.enqueue(() => this.lost(attachment)).catch((error) =>
            this.options.onError(error),
          );
        },
      };
      this.attachment = attachment;
      connection.on("Target.targetDestroyed", attachment.onDestroyed);
      // Subscribe before checking existence: the client may have died while B
      // was being bootstrapped, before it could acknowledge registration.
      try {
        const targets = await connection.getTargets();
        const target = targets.find((target) => target.targetId === request.targetId);
        if (!target) {
          await this.lost(attachment);
          throw new Error("Stagehand client disconnected during registration");
        }
        if (target.url !== CLIENT_TARGET_URL) {
          throw new Error("Invalid Stagehand client connection target");
        }
      } catch (error) {
        if (this.attachment === attachment) this.removeAttachment();
        throw error;
      }
    });
  }

  private async lost(attachment: Attachment): Promise<void> {
    if (this.attachment !== attachment) return;
    this.removeAttachment();
    if (attachment.closeBrowserOnDisconnect) {
      // Do not wait for abandoned RPC work (which may require the dead client)
      // before terminating owned Chrome. Browser.close can close B before replying.
      try {
        await attachment.connection.send("Browser.close");
      } catch (error) {
        if (attachment.connection.connected) throw error;
      }
      return;
    }
    // Preserve B and the browser, but release the old client session so a later
    // SDK can initialize using the existing runtime and tabs.
    await this.options.releaseClient();
  }

  private removeAttachment(): void {
    const attachment = this.attachment;
    this.attachment = undefined;
    attachment?.connection.off("Target.targetDestroyed", attachment.onDestroyed);
  }

  private enqueue(work: () => Promise<void>): Promise<void> {
    const result = this.tail.then(work, work);
    this.tail = result.catch(() => undefined);
    return result;
  }
}
