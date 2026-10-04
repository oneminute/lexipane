import { describe, expect, it } from "vitest";
import {
  isRetryableAiError,
  normalizeAiExecutionPolicy,
} from "./executionPolicy";

describe("AI execution policy", () => {
  it("normalizes unsafe values to task defaults", () => {
    const policy = normalizeAiExecutionPolicy("explain", {
      timeoutMs: 10,
      retries: 99,
      retryDelayMs: -1,
    });

    expect(policy.timeoutMs).toBe(120000);
    expect(policy.retries).toBe(1);
    expect(policy.retryDelayMs).toBe(700);
  });

  it("retries transient HTTP and timeout errors", () => {
    expect(isRetryableAiError(new Error("HTTP 429"))).toBe(true);
    expect(isRetryableAiError(new Error("HTTP 503"))).toBe(true);
    expect(isRetryableAiError(new Error("request timed out"))).toBe(true);
  });

  it("does not retry authentication or schema failures", () => {
    expect(isRetryableAiError(new Error("HTTP 401"))).toBe(false);
    expect(
      isRetryableAiError(
        new Error("Structured explanation is missing meaningInContext"),
      ),
    ).toBe(false);
  });
});
