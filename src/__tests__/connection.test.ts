import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BaileysClientConfig, ConnectionState } from "../types.js";

// Capture the callback passed to sock.ev.process()
type EventProcessor = (events: Record<string, any>) => Promise<void>;
let capturedProcessor: EventProcessor;

const mockSaveCreds = vi.fn();
const mockSock = {
  ev: {
    process: vi.fn((cb: EventProcessor) => {
      capturedProcessor = cb;
    }),
  },
  user: { id: "123@s.whatsapp.net", name: "TestUser" },
  groupFetchAllParticipating: vi.fn().mockResolvedValue({}),
};

vi.mock("@whiskeysockets/baileys", () => ({
  DisconnectReason: { loggedOut: 401 },
  fetchLatestBaileysVersion: vi.fn().mockResolvedValue({
    version: [2, 2413, 1],
    isLatest: true,
  }),
  isJidGroup: vi.fn(),
  makeCacheableSignalKeyStore: vi.fn().mockReturnValue({}),
  makeWASocket: vi.fn().mockReturnValue(mockSock),
  useMultiFileAuthState: vi.fn().mockResolvedValue({
    state: { creds: {}, keys: {} },
    saveCreds: mockSaveCreds,
  }),
}));

vi.mock("p-retry", () => ({
  default: vi.fn(),
}));

vi.mock("../connection-handler.js", () => ({
  handleConnectionClose: vi.fn(),
}));

vi.mock("../utils.js", () => ({
  generateAsciiQR: vi.fn().mockResolvedValue("ascii-qr"),
}));

describe("connection event processing", () => {
  let config: BaileysClientConfig;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    config = {
      authDir: "/tmp/test-auth",
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      } as any,
      hooks: {
        onDisconnected: vi.fn(),
      },
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function initConnection(): Promise<{
    processEvents: EventProcessor;
    connectionState: ConnectionState;
  }> {
    const { startConnection } = await import("../connection.js");
    const result = await startConnection(config);
    return { processEvents: capturedProcessor, connectionState: result.connectionState };
  }

  it("skips saveCreds when event batch contains a logout disconnect", async () => {
    const { processEvents } = await initConnection();

    await processEvents({
      "connection.update": {
        connection: "close",
        lastDisconnect: {
          error: { output: { statusCode: 401 } },
        },
      },
      "creds.update": {},
    });

    expect(mockSaveCreds).not.toHaveBeenCalled();
  });

  it("calls saveCreds when event batch has creds.update without connection close", async () => {
    const { processEvents } = await initConnection();

    await processEvents({
      "creds.update": {},
    });

    expect(mockSaveCreds).toHaveBeenCalledTimes(1);
  });

  it("calls saveCreds when event batch has a non-logout close", async () => {
    const { processEvents } = await initConnection();

    await processEvents({
      "connection.update": {
        connection: "close",
        lastDisconnect: {
          error: { output: { statusCode: 500 } },
        },
      },
      "creds.update": {},
    });

    expect(mockSaveCreds).toHaveBeenCalledTimes(1);
  });

  it('sets status to "syncing" after connection open (not "connected")', async () => {
    const { processEvents, connectionState } = await initConnection();

    await processEvents({
      "connection.update": { connection: "open" },
    });

    expect(connectionState.status).toBe("syncing");
  });

  it('promotes to "connected" when messaging-history.set fires with isLatest: true', async () => {
    const { processEvents, connectionState } = await initConnection();

    await processEvents({
      "connection.update": { connection: "open" },
    });
    expect(connectionState.status).toBe("syncing");

    await processEvents({
      "messaging-history.set": { chats: [], contacts: [], messages: [], isLatest: true },
    });

    expect(connectionState.status).toBe("connected");
  });

  it('stays "syncing" when messaging-history.set fires with isLatest: false', async () => {
    const { processEvents, connectionState } = await initConnection();

    await processEvents({
      "connection.update": { connection: "open" },
    });

    await processEvents({
      "messaging-history.set": { chats: [], contacts: [], messages: [], isLatest: false },
    });

    expect(connectionState.status).toBe("syncing");
  });

  it("fires onReady hook when history sync completes", async () => {
    const onReady = vi.fn();
    config.hooks = { ...config.hooks, onReady };
    const { processEvents } = await initConnection();

    await processEvents({
      "connection.update": { connection: "open" },
    });

    expect(onReady).not.toHaveBeenCalled();

    await processEvents({
      "messaging-history.set": { chats: [], contacts: [], messages: [], isLatest: true },
    });

    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it("syncs group metadata after history sync, not on connection open", async () => {
    const { processEvents } = await initConnection();

    await processEvents({
      "connection.update": { connection: "open" },
    });
    expect(mockSock.groupFetchAllParticipating).not.toHaveBeenCalled();

    await processEvents({
      "messaging-history.set": { chats: [], contacts: [], messages: [], isLatest: true },
    });
    expect(mockSock.groupFetchAllParticipating).toHaveBeenCalledTimes(1);
  });

  it('promotes to "connected" via fallback timeout if isLatest never fires', async () => {
    config.historySyncTimeoutMs = 5_000;
    const onReady = vi.fn();
    config.hooks = { ...config.hooks, onReady };
    const { processEvents, connectionState } = await initConnection();

    await processEvents({
      "connection.update": { connection: "open" },
    });
    expect(connectionState.status).toBe("syncing");

    vi.advanceTimersByTime(5_000);

    expect(connectionState.status).toBe("connected");
    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it("cancels fallback timeout when isLatest fires before timeout", async () => {
    config.historySyncTimeoutMs = 5_000;
    const onReady = vi.fn();
    config.hooks = { ...config.hooks, onReady };
    const { processEvents, connectionState } = await initConnection();

    await processEvents({
      "connection.update": { connection: "open" },
    });

    await processEvents({
      "messaging-history.set": { chats: [], contacts: [], messages: [], isLatest: true },
    });
    expect(onReady).toHaveBeenCalledTimes(1);

    // Advance past the timeout — onReady should NOT fire again
    vi.advanceTimersByTime(5_000);
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(connectionState.status).toBe("connected");
  });

  it("passes isLatest through to onHistorySync hook", async () => {
    const onHistorySync = vi.fn();
    config.hooks = { ...config.hooks, onHistorySync };
    const { processEvents } = await initConnection();

    await processEvents({
      "connection.update": { connection: "open" },
    });

    await processEvents({
      "messaging-history.set": { chats: [], contacts: [], messages: [], isLatest: false },
    });
    expect(onHistorySync).toHaveBeenCalledWith(expect.objectContaining({ isLatest: false }));

    await processEvents({
      "messaging-history.set": { chats: [], contacts: [], messages: [], isLatest: true },
    });
    expect(onHistorySync).toHaveBeenCalledWith(expect.objectContaining({ isLatest: true }));
  });
});
