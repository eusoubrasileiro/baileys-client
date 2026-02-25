import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BaileysClientConfig } from "../types.js";

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

  async function initConnection() {
    const { startConnection } = await import("../connection.js");
    await startConnection(config);
    return capturedProcessor;
  }

  it("skips saveCreds when event batch contains a logout disconnect", async () => {
    const processEvents = await initConnection();

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
    const processEvents = await initConnection();

    await processEvents({
      "creds.update": {},
    });

    expect(mockSaveCreds).toHaveBeenCalledTimes(1);
  });

  it("calls saveCreds when event batch has a non-logout close", async () => {
    const processEvents = await initConnection();

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
});
