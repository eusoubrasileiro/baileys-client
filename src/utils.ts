import {
  isJidGroup,
  jidNormalizedUser,
  normalizeMessageContent,
  type WAMessage,
} from "@whiskeysockets/baileys";
import qrcode from "qrcode-terminal";
import type { MediaInfo, ParsedMessage } from "./types.js";

// --- JID helpers ---

export function phoneToJid(phone: string): string {
  const cleaned = phone.replace(/[^0-9]/g, "");
  return `${cleaned}@s.whatsapp.net`;
}

export function normalizeJid(jid: string): string {
  return jidNormalizedUser(jid);
}

export function isGroupJid(jid: string): boolean {
  return isJidGroup(jid) ?? false;
}

/** True for privacy LID JIDs (`<id>@lid`), false for phone-number/group JIDs. */
export function isLidJid(jid: string): boolean {
  return jid.endsWith("@lid");
}

// --- QR code ---

export function generateAsciiQR(data: string): Promise<string> {
  return new Promise((resolve) => {
    qrcode.generate(data, { small: true }, (qr: string) => {
      resolve(qr);
    });
  });
}

// --- Media ---

function uint8ArrayToBase64(arr: Uint8Array | Buffer | null | undefined): string | null {
  if (!arr) return null;
  return Buffer.from(arr).toString("base64");
}

export const mimetypeToExtension: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "video/3gpp": "3gp",
  "audio/ogg": "ogg",
  "audio/ogg; codecs=opus": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/aac": "aac",
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/zip": "zip",
  "text/plain": "txt",
};

export function extractMediaInfo(message: WAMessage["message"]): MediaInfo | null {
  if (!message) return null;

  const mediaTypes = [
    { key: "imageMessage" as const, type: "image" },
    { key: "videoMessage" as const, type: "video" },
    { key: "audioMessage" as const, type: "audio" },
    { key: "documentMessage" as const, type: "document" },
    { key: "stickerMessage" as const, type: "sticker" },
  ];

  for (const { key, type } of mediaTypes) {
    const media = message[key];
    if (!media) continue;

    let mediaType = type;
    if (key === "audioMessage" && (media as any).ptt === true) {
      mediaType = "ptt";
    }

    return {
      media_type: mediaType,
      mimetype: (media as any).mimetype ?? null,
      media_key: uint8ArrayToBase64((media as any).mediaKey),
      direct_path: (media as any).directPath ?? null,
      media_url: (media as any).url ?? null,
      file_length: (media as any).fileLength ? Number((media as any).fileLength) : null,
      file_sha256: uint8ArrayToBase64((media as any).fileSha256),
      file_enc_sha256: uint8ArrayToBase64((media as any).fileEncSha256),
    };
  }

  return null;
}

// --- Message parsing ---

export function parseMessage(msg: WAMessage): ParsedMessage | null {
  if (!msg.message || !msg.key?.remoteJid) {
    return null;
  }

  const message = normalizeMessageContent(msg.message);
  if (!message) return null;

  let content: string | null = null;

  if (message.conversation) {
    content = message.conversation;
  } else if (message.extendedTextMessage?.text) {
    content = message.extendedTextMessage.text;
  } else if (message.imageMessage?.caption) {
    content = `[Image] ${message.imageMessage.caption}`;
  } else if (message.videoMessage?.caption) {
    content = `[Video] ${message.videoMessage.caption}`;
  } else if (message.documentMessage?.caption || message.documentMessage?.fileName) {
    content = `[Document] ${
      message.documentMessage.caption || message.documentMessage.fileName || ""
    }`;
  } else if (message.audioMessage) {
    content = "[Audio]";
  } else if (message.stickerMessage) {
    content = "[Sticker]";
  } else if (message.locationMessage?.address) {
    content = `[Location] ${message.locationMessage.address}`;
  } else if (message.contactMessage?.displayName) {
    content = `[Contact] ${message.contactMessage.displayName}`;
  } else if (message.pollCreationMessage?.name) {
    content = `[Poll] ${message.pollCreationMessage.name}`;
  }

  if (!content) {
    if (message.imageMessage) content = "[Image]";
    else if (message.videoMessage) content = "[Video]";
    else if (message.documentMessage) content = "[Document]";
    else if (message.audioMessage) content = "[Audio]";
    else return null;
  }

  let timestampSeconds: number;
  if (msg.messageTimestamp != null) {
    timestampSeconds = Number(msg.messageTimestamp);
  } else {
    timestampSeconds = Date.now() / 1000;
  }
  const timestamp = new Date(timestampSeconds * 1000);

  let senderJid: string | null | undefined = msg.key.participant;
  if (!msg.key.fromMe && !senderJid && !isJidGroup(msg.key.remoteJid)) {
    senderJid = msg.key.remoteJid;
  }
  if (msg.key.fromMe && !isJidGroup(msg.key.remoteJid)) {
    senderJid = null;
  }

  const mediaInfo = extractMediaInfo(message);

  const addressingMode = msg.key.addressingMode;

  return {
    id: msg.key.id!,
    chat_jid: msg.key.remoteJid,
    sender: senderJid ? jidNormalizedUser(senderJid) : null,
    chat_jid_alt: msg.key.remoteJidAlt ?? null,
    sender_alt: msg.key.participantAlt ? jidNormalizedUser(msg.key.participantAlt) : null,
    addressing_mode: addressingMode === "pn" || addressingMode === "lid" ? addressingMode : null,
    content,
    timestamp,
    is_from_me: msg.key.fromMe ?? false,
    media_type: mediaInfo?.media_type ?? null,
    mimetype: mediaInfo?.mimetype ?? null,
    media_key: mediaInfo?.media_key ?? null,
    direct_path: mediaInfo?.direct_path ?? null,
    media_url: mediaInfo?.media_url ?? null,
    file_length: mediaInfo?.file_length ?? null,
    file_sha256: mediaInfo?.file_sha256 ?? null,
    file_enc_sha256: mediaInfo?.file_enc_sha256 ?? null,
  };
}
