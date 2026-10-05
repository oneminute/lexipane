import { describe, expect, it } from "vitest";
import {
  DEFAULT_SENTENCE_PREFETCH_COUNT,
  normalizeSentencePrefetchCount,
} from "./preferences";

describe("sentence AI prefetch preferences", () => {
  it("keeps the configured count within the supported range", () => {
    expect(normalizeSentencePrefetchCount(-3)).toBe(0);
    expect(normalizeSentencePrefetchCount(0)).toBe(0);
    expect(normalizeSentencePrefetchCount(4.9)).toBe(4);
    expect(normalizeSentencePrefetchCount(10)).toBe(10);
    expect(normalizeSentencePrefetchCount(99)).toBe(10);
  });

  it("falls back for non-finite values", () => {
    expect(normalizeSentencePrefetchCount(Number.NaN)).toBe(
      DEFAULT_SENTENCE_PREFETCH_COUNT,
    );
  });
});
