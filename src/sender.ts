import {
  downloadMediaMessage,
  getUrlFromDirectPath,
  jidNormalizedUser,
  toBuffer,
} from "@whiskeysockets/baileys";
import type { Logger } from "pino";
import type { DownloadMediaParams, WhatsAppSocket } from "./types.js";

type SendResult = {
  success: boolean;
  messageId?: string;
  error?: string;
};

export async function sendTextMessage(
  socket: WhatsAppSocket,
  jid: string,
  text: string,
  logger: Logger,
): Promise<SendResult> {
  if (!socket.user) {
    return { success: false, error: "WhatsApp socket not connected" };
  }
  try {
    const normalizedJid = jidNormalizedUser(jid);
    const result = await socket.sendMessage(normalizedJid, { text });
    return { success: true, messageId: result?.key.id ?? undefined };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ err: error, recipientJid: jid }, "Failed to send message");
    return { success: false, error: message };
  }
}

export async function sendMediaMessage(
  socket: WhatsAppSocket,
  jid: string,
  media: {
    buffer: Buffer;
    type: "image" | "video" | "document" | "audio";
    caption?: string;
    fileName?: string;
    mimetype?: string;
  },
  logger: Logger,
): Promise<SendResult> {
  if (!socket.user) {
    return { success: false, error: "WhatsApp socket not connected" };
  }
  try {
    const normalizedJid = jidNormalizedUser(jid);
    let messageContent: any = {};

    if (media.type === "image") messageContent = { image: media.buffer, caption: media.caption };
    else if (media.type === "video")
      messageContent = { video: media.buffer, caption: media.caption };
    else if (media.type === "audio")
      messageContent = { audio: media.buffer, mimetype: media.mimetype ?? "audio/mp4" };
    else if (media.type === "document")
      messageContent = {
        document: media.buffer,
        caption: media.caption,
        fileName: media.fileName,
      };

    const result = await socket.sendMessage(normalizedJid, messageContent);
    return { success: true, messageId: result?.key.id ?? undefined };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ err: error, recipientJid: jid }, "Failed to send media");
    return { success: false, error: message };
  }
}

function mediaTypeToMessageKey(mediaType: string): string {
  switch (mediaType) {
    case "image":
      return "imageMessage";
    case "video":
      return "videoMessage";
    case "audio":
    case "ptt":
      return "audioMessage";
    case "document":
      return "documentMessage";
    case "sticker":
      return "stickerMessage";
    default:
      return "imageMessage";
  }
}

/**
 * Download media from WhatsApp using stored metadata.
 * Uses Baileys' downloadMediaMessage which automatically handles expired URLs:
 * on HTTP 410/404 it calls socket.updateMediaMessage() to get a fresh URL
 * from WhatsApp servers and retries the download.
 */
export async function downloadMedia(
  socket: WhatsAppSocket,
  params: DownloadMediaParams,
  logger: Logger,
): Promise<Buffer> {
  const { mediaKey, directPath, mediaUrl, mediaType, messageId, chatJid, fromMe } = params;
  const mediaKeyBuffer = new Uint8Array(Buffer.from(mediaKey, "base64"));

  const messageKey = mediaTypeToMessageKey(mediaType);
  const msg = {
    key: { remoteJid: chatJid, id: messageId, fromMe },
    message: {
      [messageKey]: {
        mediaKey: mediaKeyBuffer,
        directPath,
        url: mediaUrl || getUrlFromDirectPath(directPath),
      },
    },
  };

  const result = await downloadMediaMessage(
    msg as any,
    "buffer",
    {},
    {
      logger,
      reuploadRequest: socket.updateMediaMessage,
    },
  );

  return Buffer.isBuffer(result) ? result : await toBuffer(result as any);
}
