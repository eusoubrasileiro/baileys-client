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

  it("populates connectionState.user with sock.user.name on connection.open", async () => {
    mockSock.user = { id: "553188887777@s.whatsapp.net", name: "TestUser" };
    const { processEvents, connectionState } = await initConnection();

    await processEvents({
      "connection.update": { connection: "open" },
    });

    expect(connectionState.user).toBe("TestUser");
  });

  it("falls back to JID phone portion when sock.user.name is undefined on first open", async () => {
    mockSock.user = { id: "553188887777:11@s.whatsapp.net", name: undefined as any };
    const { processEvents, connectionState } = await initConnection();

    await processEvents({
      "connection.update": { connection: "open" },
    });

    // Bug this prevents: qr-server showed "Linked as ?" because user stayed null
    // Fallback strips device-number (":11") and suffix ("@s.whatsapp.net").
    expect(connectionState.user).toBe("553188887777");
  });

  it("upgrades connectionState.user on creds.update once sock.user.name appears", async () => {
    mockSock.user = { id: "553188887777:11@s.whatsapp.net", name: undefined as any };
    const { processEvents, connectionState } = await initConnection();

    await processEvents({
      "connection.update": { connection: "open" },
    });
    expect(connectionState.user).toBe("553188887777");

    // Baileys later populates name via creds update
    mockSock.user = { id: "553188887777:11@s.whatsapp.net", name: "Alice" };

    await processEvents({
      "creds.update": {},
    });

    expect(connectionState.user).toBe("Alice");
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

  it('promotes to "connected" via inactivity timeout if isLatest never fires', async () => {
    config.historySyncInactivityTimeoutMs = 5_000;
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

  it("cancels inactivity timeout when isLatest fires before timeout", async () => {
    config.historySyncInactivityTimeoutMs = 5_000;
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

  it("resets inactivity timeout on each history sync batch", async () => {
    config.historySyncInactivityTimeoutMs = 5_000;
    const onReady = vi.fn();
    config.hooks = { ...config.hooks, onReady };
    const { processEvents, connectionState } = await initConnection();

    await processEvents({
      "connection.update": { connection: "open" },
    });
    expect(connectionState.status).toBe("syncing");

    // First batch at t=0
    await processEvents({
      "messaging-history.set": {
        chats: [{ id: "a" }],
        contacts: [],
        messages: [],
        isLatest: false,
      },
    });

    // Advance 4s (just before timeout) — still syncing
    vi.advanceTimersByTime(4_000);
    expect(connectionState.status).toBe("syncing");

    // Second batch at t=4s resets the timer
    await processEvents({
      "messaging-history.set": {
        chats: [],
        contacts: [{ id: "b" }],
        messages: [],
        isLatest: false,
      },
    });

    // Advance another 4s (t=8s, but only 4s since last batch) — still syncing
    vi.advanceTimersByTime(4_000);
    expect(connectionState.status).toBe("syncing");

    // Advance past the inactivity timeout (5s since last batch)
    vi.advanceTimersByTime(1_000);
    expect(connectionState.status).toBe("connected");
    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it("tracks sync progress across batches", async () => {
    const { processEvents, connectionState } = await initConnection();

    await processEvents({
      "connection.update": { connection: "open" },
    });

    expect(connectionState.syncProgress).toEqual({
      chats: 0,
      contacts: 0,
      messages: 0,
      lastBatchAt: null,
    });

    await processEvents({
      "messaging-history.set": {
        chats: [{ id: "c1" }, { id: "c2" }],
        contacts: [{ id: "ct1" }],
        messages: [{ key: { id: "m1" } }, { key: { id: "m2" } }, { key: { id: "m3" } }],
        isLatest: false,
      },
    });

    expect(connectionState.syncProgress.chats).toBe(2);
    expect(connectionState.syncProgress.contacts).toBe(1);
    expect(connectionState.syncProgress.messages).toBe(3);
    expect(connectionState.syncProgress.lastBatchAt).toBeInstanceOf(Date);

    await processEvents({
      "messaging-history.set": {
        chats: [{ id: "c3" }],
        contacts: [],
        messages: [{ key: { id: "m4" } }],
        isLatest: true,
      },
    });

    expect(connectionState.syncProgress.chats).toBe(3);
    expect(connectionState.syncProgress.contacts).toBe(1);
    expect(connectionState.syncProgress.messages).toBe(4);
  });

  it("passes syncFullHistory: true to makeWASocket by default", async () => {
    const { makeWASocket } = await import("@whiskeysockets/baileys");
    await initConnection();
    expect(makeWASocket).toHaveBeenCalledWith(
      expect.objectContaining({ syncFullHistory: true }),
    );
  });

  it("passes syncFullHistory: false when explicitly configured", async () => {
    config.syncFullHistory = false;
    const { makeWASocket } = await import("@whiskeysockets/baileys");
    await initConnection();
    expect(makeWASocket).toHaveBeenCalledWith(
      expect.objectContaining({ syncFullHistory: false }),
    );
  });

  it("resets sync progress on new connection", async () => {
    const { processEvents, connectionState } = await initConnection();

    await processEvents({
      "connection.update": { connection: "open" },
    });

    await processEvents({
      "messaging-history.set": {
        chats: [{ id: "c1" }],
        contacts: [{ id: "ct1" }],
        messages: [{ key: { id: "m1" } }],
        isLatest: true,
      },
    });

    expect(connectionState.syncProgress.chats).toBe(1);

    // Simulate reconnection
    await processEvents({
      "connection.update": { connection: "open" },
    });

    expect(connectionState.syncProgress).toEqual({
      chats: 0,
      contacts: 0,
      messages: 0,
      lastBatchAt: null,
    });
  });
});
