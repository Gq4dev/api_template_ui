// Helper for the `Idempotency-Key` header on `create` (see INTEGRATION.md §8).
//
// One key must be minted per *logical* create attempt and reused across retries of
// that same attempt (e.g. the user clicks "Create" again after a network error). A
// fresh key must be generated once the attempt succeeds or the user starts a new,
// unrelated create — otherwise a legitimate new draft would be deduped against the
// old one.
export class IdempotencyKeyManager {
  private key: string | null = null;

  /** Returns the current attempt's key, minting one on first use. */
  current(): string {
    if (!this.key) {
      this.key = crypto.randomUUID();
    }
    return this.key;
  }

  /** Call after a successful create (or when starting an unrelated attempt). */
  reset(): void {
    this.key = null;
  }
}
