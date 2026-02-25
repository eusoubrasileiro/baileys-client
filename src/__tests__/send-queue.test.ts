import { describe, expect, it, vi } from "vitest";
import { createSendQueue } from "../send-queue.js";

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

describe("createSendQueue", () => {
  it("sends a text message through the queue", async () => {
    const socket = createMockSocket();
    const queue = createSendQueue(socket, mockLogger, { minDelayMs: 0, maxDelayMs: 0 });

    const result = await queue.sendText("5511999999999@s.whatsapp.net", "Hello");

    expect(result.success).toBe(true);
    expect(result.messageId).toBe("msg-123");
  });

  it("sends a media message through the queue", async () => {
    const socket = createMockSocket();
    const queue = createSendQueue(socket, mockLogger, { minDelayMs: 0, maxDelayMs: 0 });

    const result = await queue.sendMedia("5511999999999@s.whatsapp.net", {
      buffer: Buffer.from("img"),
      type: "image",
      caption: "photo",
    });

    expect(result.success).toBe(true);
    expect(result.messageId).toBe("msg-123");
  });

  it("serializes messages (sends one at a time)", async () => {
    const sendOrder: number[] = [];
    let callCount = 0;
    const socket = createMockSocket({
      sendMessage: vi.fn().mockImplementation(async () => {
        const myIndex = callCount++;
        // Simulate varying send times
        await new Promise((r) => setTimeout(r, 10));
        sendOrder.push(myIndex);
        return { key: { id: `msg-${myIndex}` } };
      }),
    });

    const queue = createSendQueue(socket, mockLogger, { minDelayMs: 0, maxDelayMs: 0 });

    const results = await Promise.all([
      queue.sendText("jid1@s.whatsapp.net", "First"),
      queue.sendText("jid2@s.whatsapp.net", "Second"),
      queue.sendText("jid3@s.whatsapp.net", "Third"),
    ]);

    expect(results.every((r) => r.success)).toBe(true);
    // Messages should be sent in order, not concurrently
    expect(sendOrder).toEqual([0, 1, 2]);
  });

  it("tracks pending count", async () => {
    let resolveFirst!: () => void;
    const firstSendPromise = new Promise<void>((r) => {
      resolveFirst = r;
    });

    const socket = createMockSocket({
      sendMessage: vi.fn().mockImplementation(async () => {
        await firstSendPromise;
        return { key: { id: "msg-1" } };
      }),
    });

    const queue = createSendQueue(socket, mockLogger, { minDelayMs: 0, maxDelayMs: 0 });

    const p1 = queue.sendText("jid1@s.whatsapp.net", "A");
    const p2 = queue.sendText("jid2@s.whatsapp.net", "B");

    // Both are pending
    expect(queue.pending).toBe(2);

    resolveFirst();
    await p1;
    await p2;

    expect(queue.pending).toBe(0);
  });

  it("returns error when disposed", async () => {
    const socket = createMockSocket();
    const queue = createSendQueue(socket, mockLogger);

    queue.dispose();

    const result = await queue.sendText("5511999999999@s.whatsapp.net", "Hello");

    expect(result.success).toBe(false);
    expect(result.error).toBe("Send queue is disposed");
    expect(socket.sendMessage).not.toHaveBeenCalled();
  });

  it("continues processing after a failed send", async () => {
    let callCount = 0;
    const socket = createMockSocket({
      sendMessage: vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 1) throw new Error("First send failed");
        return { key: { id: "msg-2" } };
      }),
    });

    const queue = createSendQueue(socket, mockLogger, { minDelayMs: 0, maxDelayMs: 0 });

    const [first, second] = await Promise.all([
      queue.sendText("jid1@s.whatsapp.net", "Fail"),
      queue.sendText("jid2@s.whatsapp.net", "Succeed"),
    ]);

    expect(first.success).toBe(false);
    expect(first.error).toBe("First send failed");
    expect(second.success).toBe(true);
    expect(second.messageId).toBe("msg-2");
  });

  it("passes SendOptions through to underlying sender", async () => {
    const socket = createMockSocket();
    const queue = createSendQueue(socket, mockLogger, { minDelayMs: 0, maxDelayMs: 0 });

    await queue.sendText("5511999999999@s.whatsapp.net", "Hello", { delay: 50 });

    // Presence simulation should have been triggered
    expect(socket.presenceSubscribe).toHaveBeenCalled();
    expect(socket.sendPresenceUpdate).toHaveBeenCalledWith(
      "composing",
      "5511999999999@s.whatsapp.net",
    );
  });
});
