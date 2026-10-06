import { describe, expect, it } from "vitest";
import {
  DEFAULT_RESOURCE_TRANSFER_CONCURRENCY,
  normalizeResourceTransferConcurrency,
} from "./preferences";

describe("resource transfer concurrency", () => {
  it("clamps the configured direct-transfer limit", () => {
    expect(normalizeResourceTransferConcurrency(0)).toBe(1);
    expect(normalizeResourceTransferConcurrency(1)).toBe(1);
    expect(normalizeResourceTransferConcurrency(4.9)).toBe(4);
    expect(normalizeResourceTransferConcurrency(8)).toBe(8);
    expect(normalizeResourceTransferConcurrency(100)).toBe(8);
  });

  it("uses the default for non-finite values", () => {
    expect(normalizeResourceTransferConcurrency(Number.NaN)).toBe(
      DEFAULT_RESOURCE_TRANSFER_CONCURRENCY,
    );
  });
});
