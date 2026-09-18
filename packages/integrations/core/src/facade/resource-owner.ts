/** Retains ownership until cleanup succeeds, including a failed SDK close. */
export class FacadeResourceOwner<Resource> {
  private resources: Promise<Resource> | undefined;
  private cleanup: Promise<void> | undefined;

  constructor(
    private readonly create: () => Promise<Resource>,
    private readonly release: (resources: Resource) => Promise<void>,
  ) {}

  async get(): Promise<Resource> {
    await this.cleanup;
    this.resources ??= this.create().catch((error) => {
      this.resources = undefined;
      throw error;
    });
    return this.resources;
  }

  peek(): Promise<Resource> | undefined {
    return this.resources;
  }

  async close(expected: Resource): Promise<void> {
    const owned = this.resources;
    const current = await owned?.catch(() => undefined);
    if (this.resources !== owned || current !== expected) return;
    this.cleanup ??= Promise.resolve()
      .then(() => this.release(expected))
      .then(() => {
        this.resources = undefined;
        this.cleanup = undefined;
      });
    // Retain a rejected cleanup: an SDK may cache its failed close promise.
    // Refuse replacement launches while the old browser's release is unconfirmed.
    await this.cleanup;
  }
}
