import pRetry, { AbortError } from "p-retry";
import { describe, expect, it, vi } from "vitest";

// Contract tests pinning the p-retry API consumed by src/connection-handler.ts.
// Must stay green across p-retry 7 → 8.
// A failure means the consumed option keys or error callback shape diverged.

describe("p-retry contract", () => {
  it("retries the configured number of times and throws on exhaustion", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("nope"));
    await expect(
      pRetry(fn, {
        retries: 2,
        minTimeout: 1,
        maxTimeout: 2,
        factor: 2,
      }),
    ).rejects.toThrow("nope");
    // initial attempt + 2 retries = 3 total invocations
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("resolves on first success", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await pRetry(fn, { retries: 5, minTimeout: 1, maxTimeout: 1 });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries then succeeds", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("first"))
      .mockRejectedValueOnce(new Error("second"))
      .mockResolvedValueOnce("ok");
    const result = await pRetry(fn, { retries: 5, minTimeout: 1, maxTimeout: 2 });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("AbortError short-circuits retries", async () => {
    const fn = vi.fn().mockRejectedValue(new AbortError("abort"));
    await expect(pRetry(fn, { retries: 5, minTimeout: 1, maxTimeout: 2 })).rejects.toThrow("abort");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("onFailedAttempt receives {attemptNumber, retriesLeft} on each failure", async () => {
    const onFailedAttempt = vi.fn();
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("first"))
      .mockRejectedValueOnce(new Error("second"))
      .mockResolvedValueOnce("ok");

    await pRetry(fn, {
      retries: 5,
      minTimeout: 1,
      maxTimeout: 2,
      factor: 2,
      onFailedAttempt,
    });

    expect(onFailedAttempt).toHaveBeenCalledTimes(2);
    const firstArg = onFailedAttempt.mock.calls[0][0];
    expect(typeof firstArg.attemptNumber).toBe("number");
    expect(typeof firstArg.retriesLeft).toBe("number");
    expect(firstArg.attemptNumber).toBe(1);
    // second failure callback receives decremented retriesLeft
    const secondArg = onFailedAttempt.mock.calls[1][0];
    expect(secondArg.attemptNumber).toBe(2);
    expect(secondArg.retriesLeft).toBeLessThan(firstArg.retriesLeft);
  });
});
