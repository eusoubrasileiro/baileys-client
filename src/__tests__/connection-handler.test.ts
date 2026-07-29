import { describe, expect, it, vi } from "vitest";
import { handleConnectionClose } from "../connection-handler.js";
import type {
  ConnectionCloseDeps,
  ConnectionState,
  ReconnectionStrategy,
  SocketState,
} from "../types.js";

function createMockDeps(overrides: Partial<ConnectionCloseDeps> = {}): ConnectionCloseDeps {
  const connectionState: ConnectionState = {
    status: "connected",
    qrCode: "some-qr",
    qrAscii: "ascii-qr",
    user: "TestUser",
  };

  const socketState: SocketState = {
    socket: {} as any,
  };

  return {
    logger: {
      warn: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
    } as any,
    connectionState,
    socketState,
    startConnection: vi.fn().mockResolvedValue({} as any),
    rmSync: vi.fn(),
    mkdirSync: vi.fn(),
    setTimeoutFn: vi.fn((cb: () => void) => cb()),
    pRetryFn: vi.fn().mockResolvedValue({} as any),
    authDir: "/tmp/test-auth",
    loggedOutCode: 401,
    ...overrides,
  };
}

describe("handleConnectionClose", () => {
  it("resets connection state on close", () => {
    const deps = createMockDeps();

    handleConnectionClose(500, new Error("test"), "InternalError", deps);

    expect(deps.connectionState.status).toBe("disconnected");
    expect(deps.connectionState.qrCode).toBeNull();
    expect(deps.connectionState.qrAscii).toBeNull();
    expect(deps.connectionState.user).toBeNull();
    expect(deps.socketState.socket).toBeNull();
  });

  it("retries with p-retry using the exact option shape consumed by p-retry v7+", () => {
    const deps = createMockDeps();

    handleConnectionClose(500, new Error("server error"), "InternalError", deps);

    expect(deps.rmSync).not.toHaveBeenCalled();
    expect(deps.pRetryFn).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        retries: 10,
        minTimeout: 1000,
        maxTimeout: 60000,
        factor: 2,
        onFailedAttempt: expect.any(Function),
      }),
    );
  });

  it("onFailedAttempt callback reads err.attemptNumber and err.retriesLeft", () => {
    const deps = createMockDeps();

    handleConnectionClose(500, new Error("server error"), "InternalError", deps);

    const [, options] = (deps.pRetryFn as any).mock.calls[0];
    options.onFailedAttempt({ attemptNumber: 2, retriesLeft: 8, message: "x" });

    const reconnectCall = (deps.logger.warn as any).mock.calls.at(-1)[0];
    expect(reconnectCall).toContain("2");
    expect(reconnectCall).toContain("8");
  });

  it("clears auth and reconnects on logout", () => {
    const deps = createMockDeps();

    handleConnectionClose(401, new Error("logged out"), "loggedOut", deps);

    expect(deps.rmSync).toHaveBeenCalledWith("/tmp/test-auth", {
      recursive: true,
      force: true,
    });
    expect(deps.mkdirSync).toHaveBeenCalledWith("/tmp/test-auth", {
      recursive: true,
    });
    expect(deps.startConnection).toHaveBeenCalledTimes(1);
    expect(deps.pRetryFn).not.toHaveBeenCalled();
  });

  it("logs warning with error and reason", () => {
    const deps = createMockDeps();
    const error = new Error("some error");

    handleConnectionClose(500, error, "InternalError", deps);

    expect(deps.logger.warn).toHaveBeenCalledWith(
      { err: error },
      "Connection closed. Reason: InternalError",
    );
  });

  it("handles undefined statusCode (non-logout path)", () => {
    const deps = createMockDeps();

    handleConnectionClose(undefined, undefined, "Unknown", deps);

    expect(deps.pRetryFn).toHaveBeenCalledTimes(1);
    expect(deps.rmSync).not.toHaveBeenCalled();
  });

  describe("with custom ReconnectionStrategy", () => {
    it("'giveup' path skips reconnect AND skips creds clearing", () => {
      const strategy: ReconnectionStrategy = {
        decide: vi.fn().mockReturnValue("giveup"),
        getRetryOptions: vi.fn().mockReturnValue({
          retries: 10,
          minTimeout: 1000,
          maxTimeout: 60_000,
          factor: 2,
          randomize: true,
        }),
      };
      const deps = createMockDeps({ strategy });
      const error = new Error("fatal");

      handleConnectionClose(500, error, "InternalError", deps);

      expect(strategy.decide).toHaveBeenCalledWith(500, error);
      expect(deps.pRetryFn).not.toHaveBeenCalled();
      expect(deps.rmSync).not.toHaveBeenCalled();
      expect(deps.mkdirSync).not.toHaveBeenCalled();
      expect(deps.setTimeoutFn).not.toHaveBeenCalled();
      expect(deps.startConnection).not.toHaveBeenCalled();
      // Connection state still reset — that's not retry policy.
      expect(deps.connectionState.status).toBe("disconnected");
      expect(deps.socketState.socket).toBeNull();
    });

    it("routes 'reconnect' through strategy.getRetryOptions instead of hard-coded values", () => {
      const strategy: ReconnectionStrategy = {
        decide: vi.fn().mockReturnValue("reconnect"),
        getRetryOptions: vi.fn().mockReturnValue({
          retries: 3,
          minTimeout: 500,
          maxTimeout: 5_000,
          factor: 3,
          randomize: false,
        }),
      };
      const deps = createMockDeps({ strategy });

      handleConnectionClose(500, new Error("boom"), "InternalError", deps);

      expect(deps.pRetryFn).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({
          retries: 3,
          minTimeout: 500,
          maxTimeout: 5_000,
          factor: 3,
          onFailedAttempt: expect.any(Function),
        }),
      );
      expect(strategy.getRetryOptions).toHaveBeenCalled();
    });

    it("routes 'logout' through strategy regardless of statusCode", () => {
      const strategy: ReconnectionStrategy = {
        decide: vi.fn().mockReturnValue("logout"),
        getRetryOptions: vi.fn().mockReturnValue({
          retries: 10,
          minTimeout: 1000,
          maxTimeout: 60_000,
          factor: 2,
          randomize: true,
        }),
      };
      // statusCode is 500, not loggedOut — but the strategy says logout.
      const deps = createMockDeps({ strategy });

      handleConnectionClose(500, new Error("boom"), "InternalError", deps);

      expect(deps.rmSync).toHaveBeenCalled();
      expect(deps.mkdirSync).toHaveBeenCalled();
      expect(deps.startConnection).toHaveBeenCalledTimes(1);
      expect(deps.pRetryFn).not.toHaveBeenCalled();
    });
  });

  describe("per-attempt timeout", () => {
    /** Records scheduled timers instead of running them, so tests fire them by hand. */
    function createTimerRecorder() {
      const timers: Array<{ cb: () => void; ms: number }> = [];
      return {
        timers,
        setTimeoutFn: vi.fn((cb: () => void, ms: number) => {
          timers.push({ cb, ms });
        }),
      };
    }

    /** The attempt function the handler hands to `pRetryFn`. */
    function attemptFnOf(deps: ConnectionCloseDeps): () => Promise<unknown> {
      return (deps.pRetryFn as any).mock.calls[0][0];
    }

    it("counts a startConnection that never settles as a failed attempt", async () => {
      const { timers, setTimeoutFn } = createTimerRecorder();
      const deps = createMockDeps({
        startConnection: vi.fn(() => new Promise<never>(() => {})),
        setTimeoutFn,
      });

      handleConnectionClose(500, new Error("boom"), "InternalError", deps);
      const attempt = attemptFnOf(deps)();

      expect(timers).toHaveLength(1);
      expect(timers[0].ms).toBe(60_000);
      timers[0].cb();

      await expect(attempt).rejects.toThrow(/60000/);
    });

    it("leaves an attempt that resolves before the timeout untouched", async () => {
      const socket = { id: "sock" } as any;
      const { timers, setTimeoutFn } = createTimerRecorder();
      const deps = createMockDeps({
        startConnection: vi.fn().mockResolvedValue(socket),
        setTimeoutFn,
      });

      handleConnectionClose(500, new Error("boom"), "InternalError", deps);

      await expect(attemptFnOf(deps)()).resolves.toBe(socket);
      // A timer that fires after the race settled must stay harmless.
      timers[0].cb();
    });

    it("uses the timeout the strategy asks for", async () => {
      const { timers, setTimeoutFn } = createTimerRecorder();
      const strategy: ReconnectionStrategy = {
        decide: vi.fn().mockReturnValue("reconnect"),
        getRetryOptions: vi.fn().mockReturnValue({
          retries: 3,
          minTimeout: 500,
          maxTimeout: 5_000,
          factor: 3,
          randomize: false,
        }),
        getAttemptTimeoutMs: vi.fn().mockReturnValue(7_500),
      };
      const deps = createMockDeps({
        startConnection: vi.fn(() => new Promise<never>(() => {})),
        setTimeoutFn,
        strategy,
      });

      handleConnectionClose(500, new Error("boom"), "InternalError", deps);
      const attempt = attemptFnOf(deps)();

      expect(timers[0].ms).toBe(7_500);
      timers[0].cb();
      await expect(attempt).rejects.toThrow(/7500/);
    });

    it("falls back to 60s for a legacy strategy without getAttemptTimeoutMs", async () => {
      const { timers, setTimeoutFn } = createTimerRecorder();
      const legacyStrategy = {
        decide: vi.fn().mockReturnValue("reconnect"),
        getRetryOptions: vi.fn().mockReturnValue({
          retries: 3,
          minTimeout: 500,
          maxTimeout: 5_000,
          factor: 3,
          randomize: false,
        }),
      } as ReconnectionStrategy;
      const deps = createMockDeps({
        startConnection: vi.fn(() => new Promise<never>(() => {})),
        setTimeoutFn,
        strategy: legacyStrategy,
      });

      handleConnectionClose(500, new Error("boom"), "InternalError", deps);
      const attempt = attemptFnOf(deps)();

      expect(timers[0].ms).toBe(60_000);
      timers[0].cb();
      await expect(attempt).rejects.toThrow(/60000/);
    });
  });
});
