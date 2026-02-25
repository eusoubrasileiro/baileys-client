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

  it("propagates errors from downloadMediaMessage", async () => {
    mockDownloadMediaMessage.mockRejectedValue(new Error("Download failed"));

    await expect(downloadMedia(createMockSocket(), baseParams, mockLogger)).rejects.toThrow(
      "Download failed",
    );
  });
});
