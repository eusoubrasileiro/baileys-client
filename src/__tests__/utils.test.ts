import { describe, expect, it } from "vitest";
import {
  extractMediaInfo,
  isGroupJid,
  isLidJid,
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

describe("isLidJid", () => {
  it("returns true for @lid JIDs", () => {
    expect(isLidJid("11122233344455@lid")).toBe(true);
  });

  it("returns false for phone-number JIDs", () => {
    expect(isLidJid("5511999887766@s.whatsapp.net")).toBe(false);
  });

  it("returns false for group JIDs", () => {
    expect(isLidJid("123456789@g.us")).toBe(false);
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

  it("leaves LID fields null when the key has no alt identifiers", () => {
    const result = parseMessage({
      message: { conversation: "Hello" },
      key: { id: "msg-1", remoteJid: "5511999887766@s.whatsapp.net", fromMe: false },
      messageTimestamp: 1700000000,
    } as any);

    expect(result!.chat_jid_alt).toBeNull();
    expect(result!.sender_alt).toBeNull();
    expect(result!.addressing_mode).toBeNull();
  });

  it("populates chat_jid_alt and addressing_mode from a LID-addressed key", () => {
    const result = parseMessage({
      message: { conversation: "Hello from LID" },
      key: {
        id: "msg-lid",
        remoteJid: "11122233344455@lid",
        remoteJidAlt: "555177776666@s.whatsapp.net",
        addressingMode: "lid",
        fromMe: false,
      },
      messageTimestamp: 1700000000,
    } as any);

    expect(result!.chat_jid).toBe("11122233344455@lid");
    expect(result!.chat_jid_alt).toBe("555177776666@s.whatsapp.net");
    expect(result!.addressing_mode).toBe("lid");
  });

  it("populates sender_alt for a group message with participantAlt", () => {
    const result = parseMessage({
      message: { conversation: "group msg" },
      key: {
        id: "msg-grp",
        remoteJid: "123456789@g.us",
        participant: "11122233344455@lid",
        participantAlt: "555177776666:3@s.whatsapp.net",
        addressingMode: "lid",
        fromMe: false,
      },
      messageTimestamp: 1700000000,
    } as any);

    expect(result!.sender).toBe("11122233344455@lid");
    expect(result!.sender_alt).toBe("555177776666@s.whatsapp.net");
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

  it("parses viewOnce image with caption correctly", () => {
    const result = parseMessage({
      message: {
        viewOnceMessage: {
          message: {
            imageMessage: {
              caption: "view once photo",
              mimetype: "image/jpeg",
              mediaKey: new Uint8Array([1, 2, 3]),
            },
          },
        },
      },
      key: {
        id: "msg-vo-img",
        remoteJid: "5511999887766@s.whatsapp.net",
        fromMe: false,
      },
      messageTimestamp: 1700000000,
    } as any);

    expect(result).not.toBeNull();
    expect(result!.content).toBe("[Image] view once photo");
    expect(result!.media_type).toBe("image");
    expect(result!.mimetype).toBe("image/jpeg");
  });

  it("parses viewOnce audio (ptt) correctly", () => {
    const result = parseMessage({
      message: {
        viewOnceMessage: {
          message: {
            audioMessage: {
              mimetype: "audio/ogg; codecs=opus",
              ptt: true,
            },
          },
        },
      },
      key: {
        id: "msg-vo-ptt",
        remoteJid: "5511999887766@s.whatsapp.net",
        fromMe: false,
      },
      messageTimestamp: 1700000000,
    } as any);

    expect(result).not.toBeNull();
    expect(result!.content).toBe("[Audio]");
    expect(result!.media_type).toBe("ptt");
  });

  it("parses ephemeral text message correctly", () => {
    const result = parseMessage({
      message: {
        ephemeralMessage: {
          message: {
            conversation: "disappearing text",
          },
        },
      },
      key: {
        id: "msg-eph",
        remoteJid: "5511999887766@s.whatsapp.net",
        fromMe: false,
      },
      messageTimestamp: 1700000000,
    } as any);

    expect(result).not.toBeNull();
    expect(result!.content).toBe("disappearing text");
    expect(result!.media_type).toBeNull();
  });

  it("parses viewOnceMessageV2 image correctly", () => {
    const result = parseMessage({
      message: {
        viewOnceMessageV2: {
          message: {
            imageMessage: {
              caption: "v2 view once",
              mimetype: "image/png",
            },
          },
        },
      },
      key: {
        id: "msg-vo2",
        remoteJid: "5511999887766@s.whatsapp.net",
        fromMe: false,
      },
      messageTimestamp: 1700000000,
    } as any);

    expect(result).not.toBeNull();
    expect(result!.content).toBe("[Image] v2 view once");
    expect(result!.media_type).toBe("image");
  });

  it("parses documentWithCaptionMessage correctly", () => {
    const result = parseMessage({
      message: {
        documentWithCaptionMessage: {
          message: {
            documentMessage: {
              caption: "important doc",
              mimetype: "application/pdf",
              fileName: "report.pdf",
            },
          },
        },
      },
      key: {
        id: "msg-docwc",
        remoteJid: "5511999887766@s.whatsapp.net",
        fromMe: false,
      },
      messageTimestamp: 1700000000,
    } as any);

    expect(result).not.toBeNull();
    expect(result!.content).toBe("[Document] important doc");
    expect(result!.media_type).toBe("document");
  });

  it("returns correct media info for viewOnce media via extractMediaInfo", () => {
    const result = parseMessage({
      message: {
        viewOnceMessage: {
          message: {
            imageMessage: {
              caption: "media test",
              mimetype: "image/jpeg",
              mediaKey: new Uint8Array([10, 20, 30]),
              directPath: "/enc/path",
              url: "https://mmg.whatsapp.net/img",
              fileLength: 54321,
              fileSha256: new Uint8Array([40, 50, 60]),
              fileEncSha256: new Uint8Array([70, 80, 90]),
            },
          },
        },
      },
      key: {
        id: "msg-vo-media",
        remoteJid: "5511999887766@s.whatsapp.net",
        fromMe: false,
      },
      messageTimestamp: 1700000000,
    } as any);

    expect(result).not.toBeNull();
    expect(result!.media_type).toBe("image");
    expect(result!.mimetype).toBe("image/jpeg");
    expect(result!.media_key).not.toBeNull();
    expect(result!.direct_path).toBe("/enc/path");
    expect(result!.media_url).toBe("https://mmg.whatsapp.net/img");
    expect(result!.file_length).toBe(54321);
    expect(result!.file_sha256).not.toBeNull();
    expect(result!.file_enc_sha256).not.toBeNull();
  });
});
