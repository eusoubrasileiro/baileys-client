import { describe, expect, it, vi } from "vitest";
import { sendMediaMessage, sendTextMessage } from "../sender.js";

function createMockSocket(overrides: any = {}) {
  return {
    user: { id: "5511999999999@s.whatsapp.net", name: "Test" },
    sendMessage: vi.fn().mockResolvedValue({
      key: { id: "msg-123" },
    }),
    ...overrides,
  } as any;
}

const mockLogger = {
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
} as any;

describe("sendTextMessage", () => {
  it("sends a text message successfully", async () => {
    const socket = createMockSocket();

    const result = await sendTextMessage(
      socket,
      "5511999999999@s.whatsapp.net",
      "Hello",
      mockLogger,
    );

    expect(result.success).toBe(true);
    expect(result.messageId).toBe("msg-123");
    expect(socket.sendMessage).toHaveBeenCalledWith("5511999999999@s.whatsapp.net", {
      text: "Hello",
    });
  });

  it("returns error when socket has no user", async () => {
    const socket = createMockSocket({ user: null });

    const result = await sendTextMessage(
      socket,
      "5511999999999@s.whatsapp.net",
      "Hello",
      mockLogger,
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe("WhatsApp socket not connected");
  });

  it("returns error when sendMessage throws", async () => {
    const socket = createMockSocket();
    socket.sendMessage.mockRejectedValue(new Error("Network error"));

    const result = await sendTextMessage(
      socket,
      "5511999999999@s.whatsapp.net",
      "Hello",
      mockLogger,
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe("Network error");
  });
});

describe("sendMediaMessage", () => {
  it("sends an image message successfully", async () => {
    const socket = createMockSocket();
    const buffer = Buffer.from("fake-image-data");

    const result = await sendMediaMessage(
      socket,
      "5511999999999@s.whatsapp.net",
      { buffer, type: "image", caption: "A photo" },
      mockLogger,
    );

    expect(result.success).toBe(true);
    expect(result.messageId).toBe("msg-123");
    expect(socket.sendMessage).toHaveBeenCalledWith("5511999999999@s.whatsapp.net", {
      image: buffer,
      caption: "A photo",
    });
  });

  it("forwards mimetype on image when provided", async () => {
    const socket = createMockSocket();
    const buffer = Buffer.from("fake-image-data");

    await sendMediaMessage(
      socket,
      "5511999999999@s.whatsapp.net",
      { buffer, type: "image", caption: "A photo", mimetype: "image/png" },
      mockLogger,
    );

    expect(socket.sendMessage).toHaveBeenCalledWith("5511999999999@s.whatsapp.net", {
      image: buffer,
      caption: "A photo",
      mimetype: "image/png",
    });
  });

  it("sends a document with fileName", async () => {
    const socket = createMockSocket();
    const buffer = Buffer.from("fake-doc");

    const result = await sendMediaMessage(
      socket,
      "5511999999999@s.whatsapp.net",
      { buffer, type: "document", caption: "My doc", fileName: "report.pdf" },
      mockLogger,
    );

    expect(result.success).toBe(true);
    expect(socket.sendMessage).toHaveBeenCalledWith("5511999999999@s.whatsapp.net", {
      document: buffer,
      caption: "My doc",
      fileName: "report.pdf",
    });
  });

  it("forwards mimetype on document when provided", async () => {
    const socket = createMockSocket();
    const buffer = Buffer.from("fake-doc");

    await sendMediaMessage(
      socket,
      "5511999999999@s.whatsapp.net",
      { buffer, type: "document", fileName: "report.pdf", mimetype: "application/pdf" },
      mockLogger,
    );

    expect(socket.sendMessage).toHaveBeenCalledWith("5511999999999@s.whatsapp.net", {
      document: buffer,
      caption: undefined,
      fileName: "report.pdf",
      mimetype: "application/pdf",
    });
  });

  it("forwards mimetype on video when provided", async () => {
    const socket = createMockSocket();
    const buffer = Buffer.from("fake-video");

    await sendMediaMessage(
      socket,
      "5511999999999@s.whatsapp.net",
      { buffer, type: "video", caption: "clip", mimetype: "video/mp4" },
      mockLogger,
    );

    expect(socket.sendMessage).toHaveBeenCalledWith("5511999999999@s.whatsapp.net", {
      video: buffer,
      caption: "clip",
      mimetype: "video/mp4",
    });
  });

  it("sends audio with default mimetype", async () => {
    const socket = createMockSocket();
    const buffer = Buffer.from("fake-audio");

    await sendMediaMessage(
      socket,
      "5511999999999@s.whatsapp.net",
      { buffer, type: "audio" },
      mockLogger,
    );

    expect(socket.sendMessage).toHaveBeenCalledWith("5511999999999@s.whatsapp.net", {
      audio: buffer,
      mimetype: "audio/mp4",
    });
  });

  it("returns error when socket has no user", async () => {
    const socket = createMockSocket({ user: null });

    const result = await sendMediaMessage(
      socket,
      "5511999999999@s.whatsapp.net",
      { buffer: Buffer.from("x"), type: "image" },
      mockLogger,
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe("WhatsApp socket not connected");
  });

  it("returns error when sendMessage throws", async () => {
    const socket = createMockSocket();
    socket.sendMessage.mockRejectedValue(new Error("Upload failed"));

    const result = await sendMediaMessage(
      socket,
      "5511999999999@s.whatsapp.net",
      { buffer: Buffer.from("x"), type: "image" },
      mockLogger,
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe("Upload failed");
  });
});
