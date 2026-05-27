import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEventDispatcher } from "../event-dispatcher.js";
import type {
  BaileysClientHooks,
  ConnectionState,
  EventDispatcherDeps,
  SocketState,
} from "../types.js";

function freshConnectionState(): ConnectionState {
  return {
    status: "disconnected",
    qrCode: null,
    qrAscii: null,
    user: null,
    syncProgress: { chats: 0, contacts: 0, messages: 0, lastBatchAt: null },
  };
}

type Harness = {
  dispatch: (events: Record<string, any>) => Promise<void>;
  connectionState: ConnectionState;
  socketState: SocketState;
  hooks: Required<BaileysClientHooks>;
  saveCreds: ReturnType<typeof vi.fn>;
  onClose: ReturnType<typeof vi.fn>;
  syncGroupMetadata: ReturnType<typeof vi.fn>;
  generateAsciiQRFn: ReturnType<typeof vi.fn>;
  logger: {
    info: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
  };
  sock: { user: { id: string; name?: string | null } | null };
};

function buildHarness(overrides?: {
  hooks?: Partial<BaileysClientHooks>;
  inactivityTimeoutMs?: number;
  sockUser?: { id: string; name?: string | null } | null;
}): Harness {
  const connectionState = freshConnectionState();
  const defaultUser = { id: "123@s.whatsapp.net", name: "TestUser" };
  const sock = {
    user: overrides && "sockUser" in overrides ? overrides.sockUser : defaultUser,
  };
  const socketState: SocketState = { socket: sock as any };

  const hooks = {
    onQrCode: vi.fn(),
    onConnecting: vi.fn(),
    onConnected: vi.fn(),
    onDisconnected: vi.fn(),
    onMessageUpsert: vi.fn(),
    onMessagesUpdate: vi.fn(),
    onContactsUpsert: vi.fn(),
    onContactsUpdate: vi.fn(),
    onChatsUpdate: vi.fn(),
    onHistorySync: vi.fn(),
    onReady: vi.fn(),
    onGroupsSync: vi.fn(),
    onLidMapping: vi.fn(),
    ...(overrides?.hooks ?? {}),
  } as Required<BaileysClientHooks>;

  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const saveCreds = vi.fn();
  const onClose = vi.fn();
  const syncGroupMetadata = vi.fn().mockResolvedValue(undefined);
  const generateAsciiQRFn = vi.fn().mockResolvedValue("ascii-qr");

  const deps: EventDispatcherDeps = {
    connectionState,
    socketState,
    hooks,
    logger: logger as any,
    saveCreds,
    getSocketUser: () => sock.user,
    onClose,
    syncGroupMetadata,
    generateAsciiQRFn,
    inactivityTimeoutMs: overrides?.inactivityTimeoutMs ?? 60_000,
  };

  const dispatch = createEventDispatcher(deps);
  return {
    dispatch,
    connectionState,
    socketState,
    hooks,
    saveCreds,
    onClose,
    syncGroupMetadata,
    generateAsciiQRFn,
    logger,
    sock,
  };
}

describe("event-dispatcher", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("connection.update — qr", () => {
    it("sets qr_pending status, qr code, and fires onQrCode hook", async () => {
      const h = buildHarness();
      await h.dispatch({ "connection.update": { qr: "qr-string" } });

      expect(h.connectionState.status).toBe("qr_pending");
      expect(h.connectionState.qrCode).toBe("qr-string");
      expect(h.connectionState.qrAscii).toBe("ascii-qr");
      expect(h.generateAsciiQRFn).toHaveBeenCalledWith("qr-string");
      expect(h.hooks.onQrCode).toHaveBeenCalledWith("qr-string", "ascii-qr");
    });
  });

  describe("connection.update — connecting", () => {
    it("sets connecting status, clears qr, fires onConnecting", async () => {
      const h = buildHarness();
      h.connectionState.qrCode = "stale";
      h.connectionState.qrAscii = "stale-ascii";

      await h.dispatch({ "connection.update": { connection: "connecting" } });

      expect(h.connectionState.status).toBe("connecting");
      expect(h.connectionState.qrCode).toBeNull();
      expect(h.connectionState.qrAscii).toBeNull();
      expect(h.hooks.onConnecting).toHaveBeenCalledTimes(1);
    });
  });

  describe("connection.update — open", () => {
    it('sets status to "syncing", populates user, fires onConnected', async () => {
      const h = buildHarness({ sockUser: { id: "555@s.whatsapp.net", name: "Alice" } });
      await h.dispatch({ "connection.update": { connection: "open" } });

      expect(h.connectionState.status).toBe("syncing");
      expect(h.connectionState.user).toBe("Alice");
      expect(h.hooks.onConnected).toHaveBeenCalledWith({ id: "555@s.whatsapp.net", name: "Alice" });
    });

    it("falls back to JID phone portion when sock.user.name is missing", async () => {
      const h = buildHarness({ sockUser: { id: "553188887777:11@s.whatsapp.net", name: null } });
      await h.dispatch({ "connection.update": { connection: "open" } });
      expect(h.connectionState.user).toBe("553188887777");
    });

    it('stays "connecting" when sock.user is null', async () => {
      const h = buildHarness({ sockUser: null });
      await h.dispatch({ "connection.update": { connection: "open" } });
      expect(h.connectionState.status).toBe("connecting");
      expect(h.hooks.onConnected).not.toHaveBeenCalled();
    });

    it("schedules inactivity timeout that promotes to connected", async () => {
      const h = buildHarness({ inactivityTimeoutMs: 5_000 });
      await h.dispatch({ "connection.update": { connection: "open" } });
      expect(h.connectionState.status).toBe("syncing");

      vi.advanceTimersByTime(5_000);
      expect(h.connectionState.status).toBe("connected");
      expect(h.hooks.onReady).toHaveBeenCalledTimes(1);
      expect(h.syncGroupMetadata).toHaveBeenCalledTimes(1);
    });

    it("resets syncProgress on open", async () => {
      const h = buildHarness();
      h.connectionState.syncProgress = {
        chats: 5,
        contacts: 3,
        messages: 7,
        lastBatchAt: new Date(),
      };
      await h.dispatch({ "connection.update": { connection: "open" } });
      expect(h.connectionState.syncProgress).toEqual({
        chats: 0,
        contacts: 0,
        messages: 0,
        lastBatchAt: null,
      });
    });
  });

  describe("connection.update — close", () => {
    it("invokes onClose with statusCode, error and reason; fires onDisconnected", async () => {
      const h = buildHarness();
      const err = new Error("boom");

      await h.dispatch({
        "connection.update": {
          connection: "close",
          lastDisconnect: { error: { ...err, output: { statusCode: 500 } } },
        },
      });

      expect(h.onClose).toHaveBeenCalledTimes(1);
      const [statusCode, errorArg, reason] = h.onClose.mock.calls[0];
      expect(statusCode).toBe(500);
      expect(errorArg).toBeDefined();
      expect(typeof reason).toBe("string");
      expect(h.hooks.onDisconnected).toHaveBeenCalledTimes(1);
    });

    it("clears any pending sync timeout on close", async () => {
      const h = buildHarness({ inactivityTimeoutMs: 5_000 });
      await h.dispatch({ "connection.update": { connection: "open" } });

      await h.dispatch({
        "connection.update": {
          connection: "close",
          lastDisconnect: { error: { output: { statusCode: 500 } } },
        },
      });

      // Timeout was cleared — onReady must not fire after we advance time
      vi.advanceTimersByTime(5_000);
      expect(h.hooks.onReady).not.toHaveBeenCalled();
    });
  });

  describe("creds.update", () => {
    it("saves creds when no logout in same batch", async () => {
      const h = buildHarness();
      await h.dispatch({ "creds.update": {} });
      expect(h.saveCreds).toHaveBeenCalledTimes(1);
    });

    it("skips saveCreds when batch contains a logout close", async () => {
      const h = buildHarness();
      await h.dispatch({
        "connection.update": {
          connection: "close",
          lastDisconnect: { error: { output: { statusCode: 401 } } },
        },
        "creds.update": {},
      });
      expect(h.saveCreds).not.toHaveBeenCalled();
    });

    it("upgrades connectionState.user when sock.user.name appears later", async () => {
      const h = buildHarness({ sockUser: { id: "553188887777:11@s.whatsapp.net", name: null } });
      await h.dispatch({ "connection.update": { connection: "open" } });
      expect(h.connectionState.user).toBe("553188887777");

      h.sock.user = { id: "553188887777:11@s.whatsapp.net", name: "Alice" };
      await h.dispatch({ "creds.update": {} });
      expect(h.connectionState.user).toBe("Alice");
    });
  });

  describe("messaging-history.set", () => {
    it("promotes to connected and fires onReady when isLatest is true", async () => {
      const h = buildHarness();
      await h.dispatch({ "connection.update": { connection: "open" } });

      await h.dispatch({
        "messaging-history.set": {
          chats: [{ id: "a" }],
          contacts: [{ id: "b" }],
          messages: [{ key: { id: "m" } }],
          isLatest: true,
        },
      });

      expect(h.connectionState.status).toBe("connected");
      expect(h.hooks.onReady).toHaveBeenCalledTimes(1);
      expect(h.syncGroupMetadata).toHaveBeenCalledTimes(1);
    });

    it("stays syncing and resets inactivity timeout when isLatest is false", async () => {
      const h = buildHarness({ inactivityTimeoutMs: 5_000 });
      await h.dispatch({ "connection.update": { connection: "open" } });

      // First batch at t=0
      await h.dispatch({
        "messaging-history.set": {
          chats: [{ id: "a" }],
          contacts: [],
          messages: [],
          isLatest: false,
        },
      });
      expect(h.connectionState.status).toBe("syncing");

      vi.advanceTimersByTime(4_000);
      expect(h.connectionState.status).toBe("syncing");

      // Reset
      await h.dispatch({
        "messaging-history.set": {
          chats: [],
          contacts: [{ id: "b" }],
          messages: [],
          isLatest: false,
        },
      });

      vi.advanceTimersByTime(4_000);
      expect(h.connectionState.status).toBe("syncing");

      vi.advanceTimersByTime(1_000);
      expect(h.connectionState.status).toBe("connected");
    });

    it("forwards isLatest through to onHistorySync hook", async () => {
      const h = buildHarness();
      await h.dispatch({
        "messaging-history.set": {
          chats: [],
          contacts: [],
          messages: [],
          isLatest: false,
        },
      });
      expect(h.hooks.onHistorySync).toHaveBeenCalledWith(
        expect.objectContaining({ isLatest: false }),
      );
    });

    it("accumulates syncProgress counts", async () => {
      const h = buildHarness();
      await h.dispatch({ "connection.update": { connection: "open" } });
      await h.dispatch({
        "messaging-history.set": {
          chats: [{ id: "1" }, { id: "2" }],
          contacts: [{ id: "c1" }],
          messages: [{ key: { id: "m1" } }, { key: { id: "m2" } }, { key: { id: "m3" } }],
          isLatest: false,
        },
      });
      expect(h.connectionState.syncProgress.chats).toBe(2);
      expect(h.connectionState.syncProgress.contacts).toBe(1);
      expect(h.connectionState.syncProgress.messages).toBe(3);
      expect(h.connectionState.syncProgress.lastBatchAt).toBeInstanceOf(Date);
    });
  });

  describe("contacts.upsert", () => {
    it("forwards contacts to onContactsUpsert hook", async () => {
      const h = buildHarness();
      const contacts = [{ id: "1" }, { id: "2" }];
      await h.dispatch({ "contacts.upsert": contacts });
      expect(h.hooks.onContactsUpsert).toHaveBeenCalledWith(contacts);
    });
  });

  describe("contacts.update", () => {
    it("forwards updates to onContactsUpdate hook", async () => {
      const h = buildHarness();
      const updates = [{ id: "1", name: "x" }];
      await h.dispatch({ "contacts.update": updates });
      expect(h.hooks.onContactsUpdate).toHaveBeenCalledWith(updates);
    });
  });

  describe("messages.upsert", () => {
    it("forwards messages when type is notify", async () => {
      const h = buildHarness();
      const msgs = [{ key: { id: "1" } }];
      await h.dispatch({ "messages.upsert": { messages: msgs, type: "notify" } });
      expect(h.hooks.onMessageUpsert).toHaveBeenCalledWith(msgs, "notify");
    });

    it("forwards messages when type is append", async () => {
      const h = buildHarness();
      const msgs = [{ key: { id: "1" } }];
      await h.dispatch({ "messages.upsert": { messages: msgs, type: "append" } });
      expect(h.hooks.onMessageUpsert).toHaveBeenCalledWith(msgs, "append");
    });

    it("does NOT forward other types", async () => {
      const h = buildHarness();
      await h.dispatch({
        "messages.upsert": { messages: [{ key: { id: "1" } }], type: "prepend" as any },
      });
      expect(h.hooks.onMessageUpsert).not.toHaveBeenCalled();
    });
  });

  describe("messages.update", () => {
    it("forwards updates to onMessagesUpdate hook", async () => {
      const h = buildHarness();
      const updates = [{ key: { id: "1" }, update: {} }];
      await h.dispatch({ "messages.update": updates });
      expect(h.hooks.onMessagesUpdate).toHaveBeenCalledWith(updates);
    });
  });

  describe("chats.update", () => {
    it("forwards chats to onChatsUpdate hook", async () => {
      const h = buildHarness();
      const chats = [{ id: "1" }];
      await h.dispatch({ "chats.update": chats });
      expect(h.hooks.onChatsUpdate).toHaveBeenCalledWith(chats);
    });
  });

  describe("lid-mapping.update", () => {
    it("forwards mapping to onLidMapping hook", async () => {
      const h = buildHarness();
      const mapping = { lid: "11122233344455@lid", pn: "555177776666@s.whatsapp.net" };
      await h.dispatch({ "lid-mapping.update": mapping });
      expect(h.hooks.onLidMapping).toHaveBeenCalledWith(mapping);
    });
  });
});
