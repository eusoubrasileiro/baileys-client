import { describe, expect, it, vi } from "vitest";
import { sendMediaMessage, sendTextMessage } from "../sender.js";

function createMockSocket(overrides: any = {}) {
  return {
    user: { id: "5511999999999@s.whatsapp.net", name: "Test" },
    sendMessage: vi.fn().mockResolvedValue({
      key: { id: "msg-123" },
    }),
    presenceSubscribe: vi.fn().mockResolvedValue(undefined),
    sendPresenceUpdate: vi.fn().mockResolvedValue(undefined),
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

  it("simulates typing presence when delay option is set", async () => {
    const socket = createMockSocket();

    await sendTextMessage(socket, "5511999999999@s.whatsapp.net", "Hello", mockLogger, {
      delay: 100,
    });

    expect(socket.presenceSubscribe).toHaveBeenCalledWith("5511999999999@s.whatsapp.net");
    expect(socket.sendPresenceUpdate).toHaveBeenCalledWith(
      "composing",
      "5511999999999@s.whatsapp.net",
    );
    expect(socket.sendPresenceUpdate).toHaveBeenCalledWith(
      "paused",
      "5511999999999@s.whatsapp.net",
    );
    expect(socket.sendMessage).toHaveBeenCalled();
  });

  it("still sends if presence simulation fails", async () => {
    const socket = createMockSocket({
      presenceSubscribe: vi.fn().mockRejectedValue(new Error("presence error")),
    });

    const result = await sendTextMessage(
      socket,
      "5511999999999@s.whatsapp.net",
      "Hello",
      mockLogger,
      { delay: 100 },
    );

    expect(result.success).toBe(true);
    expect(socket.sendMessage).toHaveBeenCalled();
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

  it("simulates typing presence when delay option is set", async () => {
    const socket = createMockSocket();

    await sendMediaMessage(
      socket,
      "5511999999999@s.whatsapp.net",
      { buffer: Buffer.from("img"), type: "image", caption: "pic" },
      mockLogger,
      { delay: 50 },
    );

    expect(socket.presenceSubscribe).toHaveBeenCalled();
    expect(socket.sendPresenceUpdate).toHaveBeenCalledWith(
      "composing",
      "5511999999999@s.whatsapp.net",
    );
    expect(socket.sendMessage).toHaveBeenCalled();
  });
});
