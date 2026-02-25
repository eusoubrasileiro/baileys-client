import { describe, expect, it, vi } from "vitest";
import { handleConnectionClose } from "../connection-handler.js";
import type { ConnectionCloseDeps, ConnectionState, SocketState } from "../types.js";

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

  it("retries with p-retry on non-logout close", () => {
    const deps = createMockDeps();

    handleConnectionClose(500, new Error("server error"), "InternalError", deps);

    expect(deps.pRetryFn).toHaveBeenCalledTimes(1);
    expect(deps.rmSync).not.toHaveBeenCalled();
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

  it("calls onReconnectionFailed when all retries are exhausted", async () => {
    const onReconnectionFailed = vi.fn();
    const retryError = new Error("all retries failed");
    const deps = createMockDeps({
      hooks: { onReconnectionFailed },
      pRetryFn: vi.fn().mockRejectedValue(retryError),
    });

    handleConnectionClose(500, new Error("server error"), "InternalError", deps);

    // Let the promise chain settle
    await vi.waitFor(() => {
      expect(onReconnectionFailed).toHaveBeenCalledTimes(1);
    });
    expect(onReconnectionFailed).toHaveBeenCalledWith(retryError);
  });

  it("calls onReconnectionFailed when post-logout reconnect fails", async () => {
    const onReconnectionFailed = vi.fn();
    const reconnectError = new Error("reconnect failed");
    const deps = createMockDeps({
      hooks: { onReconnectionFailed },
      startConnection: vi.fn().mockRejectedValue(reconnectError),
    });

    handleConnectionClose(401, new Error("logged out"), "loggedOut", deps);

    await vi.waitFor(() => {
      expect(onReconnectionFailed).toHaveBeenCalledTimes(1);
    });
    expect(onReconnectionFailed).toHaveBeenCalledWith(reconnectError);
  });

  it("handles onReconnectionFailed hook throwing without crashing", async () => {
    const onReconnectionFailed = vi.fn().mockRejectedValue(new Error("hook exploded"));
    const deps = createMockDeps({
      hooks: { onReconnectionFailed },
      pRetryFn: vi.fn().mockRejectedValue(new Error("retries done")),
    });

    handleConnectionClose(500, new Error("server error"), "InternalError", deps);

    await vi.waitFor(() => {
      expect(onReconnectionFailed).toHaveBeenCalledTimes(1);
    });
    // Should log the hook error, not crash
    expect(deps.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      'Hook "onReconnectionFailed" threw an error',
    );
  });
});
