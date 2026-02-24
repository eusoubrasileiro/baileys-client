import { describe, expect, it } from "vitest";
import {
  extractMediaInfo,
  isGroupJid,
  mimetypeToExtension,
  normalizeJid,
  parseMessage,
  phoneToJid,
} from "../utils.js";

describe("phoneToJid", () => {
  it("converts a phone number to JID", () => {
    expect(phoneToJid("5511999887766")).toBe("5511999887766@s.whatsapp.net");
  });

  it("strips non-numeric characters", () => {
    expect(phoneToJid("+55 (11) 99988-7766")).toBe("5511999887766@s.whatsapp.net");
  });
});

describe("normalizeJid", () => {
  it("normalizes a JID with device suffix", () => {
    const result = normalizeJid("5511999887766:0@s.whatsapp.net");
    expect(result).toBe("5511999887766@s.whatsapp.net");
  });
});

describe("isGroupJid", () => {
  it("returns true for group JIDs", () => {
    expect(isGroupJid("123456789@g.us")).toBe(true);
  });

  it("returns false for individual JIDs", () => {
    expect(isGroupJid("5511999887766@s.whatsapp.net")).toBe(false);
  });
});

describe("mimetypeToExtension", () => {
  it("maps common mimetypes", () => {
    expect(mimetypeToExtension["image/jpeg"]).toBe("jpg");
    expect(mimetypeToExtension["application/pdf"]).toBe("pdf");
    expect(mimetypeToExtension["audio/ogg; codecs=opus"]).toBe("ogg");
  });
});

describe("extractMediaInfo", () => {
  it("returns null for null message", () => {
    expect(extractMediaInfo(null)).toBeNull();
  });

  it("returns null for message without media", () => {
    expect(extractMediaInfo({ conversation: "hello" } as any)).toBeNull();
  });

  it("extracts image media info", () => {
    const result = extractMediaInfo({
      imageMessage: {
        mimetype: "image/jpeg",
        mediaKey: new Uint8Array([1, 2, 3]),
        directPath: "/path/to/img",
        url: "https://example.com/img",
        fileLength: 12345,
        fileSha256: new Uint8Array([4, 5, 6]),
        fileEncSha256: new Uint8Array([7, 8, 9]),
      },
    } as any);

    expect(result).not.toBeNull();
    expect(result!.media_type).toBe("image");
    expect(result!.mimetype).toBe("image/jpeg");
    expect(result!.file_length).toBe(12345);
  });

  it("detects ptt (voice note) from audio message", () => {
    const result = extractMediaInfo({
      audioMessage: {
        mimetype: "audio/ogg; codecs=opus",
        ptt: true,
      },
    } as any);

    expect(result).not.toBeNull();
    expect(result!.media_type).toBe("ptt");
  });
});

describe("parseMessage", () => {
  it("returns null for empty message", () => {
    expect(parseMessage({} as any)).toBeNull();
  });

  it("returns null for message without remoteJid", () => {
    expect(
      parseMessage({
        message: { conversation: "hi" },
        key: { id: "1" },
      } as any),
    ).toBeNull();
  });

  it("parses a simple text message", () => {
    const result = parseMessage({
      message: { conversation: "Hello world" },
      key: {
        id: "msg-1",
        remoteJid: "5511999887766@s.whatsapp.net",
        fromMe: false,
      },
      messageTimestamp: 1700000000,
    } as any);

    expect(result).not.toBeNull();
    expect(result!.id).toBe("msg-1");
    expect(result!.content).toBe("Hello world");
    expect(result!.chat_jid).toBe("5511999887766@s.whatsapp.net");
    expect(result!.is_from_me).toBe(false);
    expect(result!.sender).toBe("5511999887766@s.whatsapp.net");
  });

  it("parses extendedTextMessage", () => {
    const result = parseMessage({
      message: { extendedTextMessage: { text: "Extended text" } },
      key: {
        id: "msg-2",
        remoteJid: "5511999887766@s.whatsapp.net",
        fromMe: true,
      },
      messageTimestamp: 1700000000,
    } as any);

    expect(result!.content).toBe("Extended text");
    expect(result!.is_from_me).toBe(true);
    expect(result!.sender).toBeNull();
  });

  it("parses image with caption", () => {
    const result = parseMessage({
      message: {
        imageMessage: {
          caption: "Check this out",
          mimetype: "image/jpeg",
        },
      },
      key: {
        id: "msg-3",
        remoteJid: "5511999887766@s.whatsapp.net",
        fromMe: false,
      },
      messageTimestamp: 1700000000,
    } as any);

    expect(result!.content).toBe("[Image] Check this out");
    expect(result!.media_type).toBe("image");
  });

  it("parses image without caption", () => {
    const result = parseMessage({
      message: {
        imageMessage: { mimetype: "image/jpeg" },
      },
      key: {
        id: "msg-4",
        remoteJid: "5511999887766@s.whatsapp.net",
        fromMe: false,
      },
      messageTimestamp: 1700000000,
    } as any);

    expect(result!.content).toBe("[Image]");
  });

  it("parses sticker message", () => {
    const result = parseMessage({
      message: { stickerMessage: { mimetype: "image/webp" } },
      key: {
        id: "msg-5",
        remoteJid: "5511999887766@s.whatsapp.net",
        fromMe: false,
      },
      messageTimestamp: 1700000000,
    } as any);

    expect(result!.content).toBe("[Sticker]");
  });

  it("sets sender from participant in group messages", () => {
    const result = parseMessage({
      message: { conversation: "hi group" },
      key: {
        id: "msg-6",
        remoteJid: "123456789@g.us",
        participant: "5511999887766@s.whatsapp.net",
        fromMe: false,
      },
      messageTimestamp: 1700000000,
    } as any);

    expect(result!.sender).toBe("5511999887766@s.whatsapp.net");
  });

  it("uses current time when messageTimestamp is null", () => {
    const before = Date.now();
    const result = parseMessage({
      message: { conversation: "hi" },
      key: {
        id: "msg-7",
        remoteJid: "5511999887766@s.whatsapp.net",
        fromMe: false,
      },
      messageTimestamp: null,
    } as any);
    const after = Date.now();

    expect(result!.timestamp.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(result!.timestamp.getTime()).toBeLessThanOrEqual(after + 1000);
  });
});
