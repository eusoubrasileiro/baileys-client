import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockDownloadMediaMessage, mockToBuffer } = vi.hoisted(() => ({
  mockDownloadMediaMessage: vi.fn(),
  mockToBuffer: vi.fn(),
}));

vi.mock("@whiskeysockets/baileys", () => ({
  downloadMediaMessage: mockDownloadMediaMessage,
  getUrlFromDirectPath: vi.fn(),
  toBuffer: mockToBuffer,
}));

import { defaultMediaRefreshAdapter } from "../media-refresh.js";
import type { MediaRefreshContext } from "../types.js";

const mockLogger = {
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
  fatal: vi.fn(),
  child: vi.fn().mockReturnThis(),
  level: "info",
} as any;

function createMockSocket(overrides: any = {}) {
  return {
    user: { id: "5511999999999@s.whatsapp.net", name: "Test" },
    updateMediaMessage: vi.fn(),
    ...overrides,
  } as any;
}

const baseMessage = {
  key: { remoteJid: "5511999999999@s.whatsapp.net", id: "msg-123", fromMe: false },
  message: {
    imageMessage: {
      mediaKey: new Uint8Array(Buffer.from("k")),
      directPath: "/v/t62/x",
      url: "https://stale-url",
    },
  },
} as any;

const baseError = new Error("ETIMEDOUT");

function makeCtx(socket: any): MediaRefreshContext {
  return {
    socket,
    logger: mockLogger,
    messageId: "msg-123",
    originalError: baseError,
  };
}

describe("defaultMediaRefreshAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls socket.updateMediaMessage with the original message and re-downloads the refreshed message", async () => {
    const refreshedMsg = {
      key: baseMessage.key,
      message: { imageMessage: { url: "https://fresh-url" } },
    };
    const socket = createMockSocket();
    socket.updateMediaMessage.mockResolvedValue(refreshedMsg);
    mockDownloadMediaMessage.mockResolvedValue(Buffer.from("fresh-bytes"));

    const adapter = defaultMediaRefreshAdapter();
    const result = await adapter.refreshAndRetry(baseMessage, makeCtx(socket));

    expect(result).toEqual(Buffer.from("fresh-bytes"));
    expect(socket.updateMediaMessage).toHaveBeenCalledOnce();
    expect(socket.updateMediaMessage).toHaveBeenCalledWith(baseMessage);
    expect(mockDownloadMediaMessage).toHaveBeenCalledOnce();
    // Second download must be against the *refreshed* message.
    expect(mockDownloadMediaMessage.mock.calls[0][0]).toBe(refreshedMsg);
  });

  it("propagates the error when the retried download also fails", async () => {
    const refreshedMsg = { key: baseMessage.key, message: {} };
    const socket = createMockSocket();
    socket.updateMediaMessage.mockResolvedValue(refreshedMsg);
    mockDownloadMediaMessage.mockRejectedValue(new Error("still broken"));

    const adapter = defaultMediaRefreshAdapter();

    await expect(adapter.refreshAndRetry(baseMessage, makeCtx(socket))).rejects.toThrow(
      "still broken",
    );
  });

  it("propagates the error when refresh itself fails", async () => {
    const socket = createMockSocket();
    socket.updateMediaMessage.mockRejectedValue(new Error("refresh failed"));

    const adapter = defaultMediaRefreshAdapter();

    await expect(adapter.refreshAndRetry(baseMessage, makeCtx(socket))).rejects.toThrow(
      "refresh failed",
    );
    expect(mockDownloadMediaMessage).not.toHaveBeenCalled();
  });

  it("converts a Readable stream from downloadMediaMessage into a Buffer", async () => {
    const socket = createMockSocket();
    socket.updateMediaMessage.mockResolvedValue(baseMessage);
    const fakeStream = { pipe: vi.fn() };
    mockDownloadMediaMessage.mockResolvedValue(fakeStream as any);
    mockToBuffer.mockResolvedValue(Buffer.from("from-stream"));

    const adapter = defaultMediaRefreshAdapter();
    const result = await adapter.refreshAndRetry(baseMessage, makeCtx(socket));

    expect(result).toEqual(Buffer.from("from-stream"));
    expect(mockToBuffer).toHaveBeenCalledWith(fakeStream);
  });
});
