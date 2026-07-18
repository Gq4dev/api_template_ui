import { describe, expect, it } from "vitest";
import { IdempotencyKeyManager } from "./idempotency";

describe("IdempotencyKeyManager", () => {
  it("mints a UUID on first current() call", () => {
    const manager = new IdempotencyKeyManager();
    const key = manager.current();
    expect(key).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it("returns the same key across subsequent current() calls (retry reuse)", () => {
    const manager = new IdempotencyKeyManager();
    const first = manager.current();
    expect(manager.current()).toBe(first);
    expect(manager.current()).toBe(first);
  });

  it("mints a different key after reset()", () => {
    const manager = new IdempotencyKeyManager();
    const first = manager.current();
    manager.reset();
    const second = manager.current();
    expect(second).not.toBe(first);
  });
});
