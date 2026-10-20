export class ActionLock {
  private active = false;
  private owner: string | null = null;

  get currentOwner(): string | null {
    return this.owner;
  }

  get isBusy(): boolean {
    return this.active;
  }

  async runExclusive<T>(owner: string, operation: () => Promise<T>): Promise<T> {
    if (this.active) {
      throw new Error(
        `RelayOps is busy with "${this.owner ?? "another action"}". Wait for it to finish before starting "${owner}".`
      );
    }

    this.active = true;
    this.owner = owner;
    try {
      return await operation();
    } finally {
      this.active = false;
      this.owner = null;
    }
  }
}
