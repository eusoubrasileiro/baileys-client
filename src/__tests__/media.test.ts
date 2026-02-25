import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockDownloadMediaMessage, mockGetUrlFromDirectPath, mockToBuffer } = vi.hoisted(() => ({
  mockDownloadMediaMessage: vi.fn(),
  mockGetUrlFromDirectPath: vi.fn(),
  mockToBuffer: vi.fn(),
}));

vi.mock("@whiskeysockets/baileys", () => ({
  downloadMediaMessage: mockDownloadMediaMessage,
  getUrlFromDirectPath: mockGetUrlFromDirectPath,
  toBuffer: mockToBuffer,
}));

import { downloadMedia } from "../media.js";
import type { DownloadMediaParams, MediaType } from "../types.js";

function createMockSocket(overrides: any = {}) {
  return {
    user: { id: "5511999999999@s.whatsapp.net", name: "Test" },
    updateMediaMessage: vi.fn(),
    ...overrides,
  } as any;
}

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

const baseParams: DownloadMediaParams = {
  mediaKey: Buffer.from("test-key").toString("base64"),
  directPath: "/v/t62/test-path",
  mediaUrl: "https://mmg.whatsapp.net/test-url",
  mediaType: "image",
  messageId: "msg-123",
  chatJid: "5511999999999@s.whatsapp.net",
  fromMe: false,
};

describe("downloadMedia", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns buffer on successful download", async () => {
    const expectedBuffer = Buffer.from("image-data");
    mockDownloadMediaMessage.mockResolvedValue(expectedBuffer);

    const result = await downloadMedia(createMockSocket(), baseParams, mockLogger);

    expect(result).toEqual(expectedBuffer);
    expect(mockDownloadMediaMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        key: { remoteJid: baseParams.chatJid, id: baseParams.messageId, fromMe: false },
      }),
      "buffer",
      {},
      expect.objectContaining({ logger: mockLogger }),
    );
  });

  it.each<[MediaType, string]>([
    ["image", "imageMessage"],
    ["video", "videoMessage"],
    ["audio", "audioMessage"],
    ["ptt", "audioMessage"],
    ["document", "documentMessage"],
    ["sticker", "stickerMessage"],
  ])("maps media type '%s' to message key '%s'", async (mediaType, expectedKey) => {
    mockDownloadMediaMessage.mockResolvedValue(Buffer.from("data"));

    await downloadMedia(createMockSocket(), { ...baseParams, mediaType }, mockLogger);

    const call = mockDownloadMediaMessage.mock.calls.at(-1);
    const msg = call?.[0];
    expect(msg.message).toHaveProperty(expectedKey);
  });

  it("falls back to getUrlFromDirectPath when mediaUrl is null", async () => {
    mockGetUrlFromDirectPath.mockReturnValue("https://fallback-url.com/media");
    mockDownloadMediaMessage.mockResolvedValue(Buffer.from("data"));

    await downloadMedia(createMockSocket(), { ...baseParams, mediaUrl: null }, mockLogger);

    expect(mockGetUrlFromDirectPath).toHaveBeenCalledWith(baseParams.directPath);
    const call = mockDownloadMediaMessage.mock.calls.at(-1);
    const msg = call?.[0];
    expect(msg.message.imageMessage.url).toBe("https://fallback-url.com/media");
  });

  it("uses provided mediaUrl when available", async () => {
    mockDownloadMediaMessage.mockResolvedValue(Buffer.from("data"));

    await downloadMedia(createMockSocket(), baseParams, mockLogger);

    const call = mockDownloadMediaMessage.mock.calls.at(-1);
    const msg = call?.[0];
    expect(msg.message.imageMessage.url).toBe(baseParams.mediaUrl);
    expect(mockGetUrlFromDirectPath).not.toHaveBeenCalled();
  });

  it("retries with refreshed URL on initial failure", async () => {
    const refreshedMsg = { key: {}, message: { imageMessage: { url: "https://refreshed-url" } } };
    const socket = createMockSocket();
    socket.updateMediaMessage.mockResolvedValue(refreshedMsg);
    mockDownloadMediaMessage
      .mockRejectedValueOnce(new Error("ETIMEDOUT"))
      .mockResolvedValueOnce(Buffer.from("refreshed-data"));

    const result = await downloadMedia(socket, baseParams, mockLogger);

    expect(result).toEqual(Buffer.from("refreshed-data"));
    expect(socket.updateMediaMessage).toHaveBeenCalledOnce();
    expect(mockDownloadMediaMessage).toHaveBeenCalledTimes(2);
    // Second call should use the refreshed message
    expect(mockDownloadMediaMessage.mock.calls[1][0]).toBe(refreshedMsg);
  });

  it("propagates error when retry also fails", async () => {
    const socket = createMockSocket();
    socket.updateMediaMessage.mockResolvedValue({ key: {}, message: {} });
    mockDownloadMediaMessage
      .mockRejectedValueOnce(new Error("ECONNREFUSED"))
      .mockRejectedValueOnce(new Error("Retry also failed"));

    await expect(downloadMedia(socket, baseParams, mockLogger)).rejects.toThrow(
      "Retry also failed",
    );
  });

  it("does not call updateMediaMessage on success", async () => {
    const socket = createMockSocket();
    mockDownloadMediaMessage.mockResolvedValue(Buffer.from("data"));

    await downloadMedia(socket, baseParams, mockLogger);

    expect(socket.updateMediaMessage).not.toHaveBeenCalled();
    expect(mockDownloadMediaMessage).toHaveBeenCalledOnce();
  });
});
