/** Retains ownership until cleanup succeeds, including a failed SDK close. */
export class FacadeResourceOwner<Resource> {
  private resources: Promise<Resource> | undefined;
  private cleanup: Promise<void> | undefined;

  constructor(
    private readonly create: () => Promise<Resource>,
    private readonly release: (resources: Resource) => Promise<void>,
  ) {}

  async get(): Promise<Resource> {
    while (this.cleanup) await this.cleanup;
    this.resources ??= Promise.resolve()
      .then(() => this.create())
      .catch((error) => {
        this.resources = undefined;
        if (error instanceof StagehandFacadeConfigError) throw error;
        throw new StagehandFacadeInitializationError();
      });
    return this.resources;
  }

  /** Reads existing resources or a pending launch without starting one during shutdown. */
  peek(): Promise<Resource> | undefined {
    return this.resources;
  }

  close(expected: Resource): Promise<void> {
    const owned = this.resources;
    const cleanup = Promise.resolve(this.cleanup)
      .then(async () => {
        const current = await owned?.catch(() => undefined);
        if (this.resources !== owned || current !== expected) return;
        try {
          await this.release(expected);
        } catch {
          throw new StagehandFacadeCleanupError();
        }
        this.resources = undefined;
      })
      .then(() => {
        if (this.cleanup === cleanup) this.cleanup = undefined;
      });
    // Register cleanup before yielding so an immediate get waits for every queued close.
    this.cleanup = cleanup;
    // Retain a rejected cleanup: an SDK may cache its failed close promise.
    // Refuse replacement launches while the old browser's release is unconfirmed.
    return cleanup;
  }
}
import { StagehandFacadeConfigError } from "./config.js";
import { StagehandFacadeCleanupError, StagehandFacadeInitializationError } from "./tools.js";
