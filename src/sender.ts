import {
  type DownloadableMessage,
  downloadContentFromMessage,
  getUrlFromDirectPath,
  jidNormalizedUser,
  type MediaType,
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
 * First tries a direct download via directPath. If the CDN URL has expired,
 * uses socket.updateMediaMessage() to request a fresh URL from WhatsApp servers,
 * then retries the download.
 */
export async function downloadMedia(
  socket: WhatsAppSocket,
  params: DownloadMediaParams,
  logger: Logger,
): Promise<Buffer> {
  const { mediaKey, directPath, mediaUrl, mediaType, messageId, chatJid, fromMe } = params;
  const mediaKeyBuffer = new Uint8Array(Buffer.from(mediaKey, "base64"));
  const baileysMediaType = (mediaType === "ptt" ? "audio" : mediaType) as MediaType;

  const makeDownloadable = (dp: string, url?: string | null): DownloadableMessage => ({
    mediaKey: mediaKeyBuffer,
    directPath: dp,
    url: url || undefined,
  });

  // Attempt 1: direct download with refreshed URL from directPath
  try {
    const refreshedUrl = getUrlFromDirectPath(directPath);
    const stream = await downloadContentFromMessage(
      makeDownloadable(directPath, refreshedUrl),
      baileysMediaType,
    );
    return await toBuffer(stream);
  } catch (error) {
    logger.warn(
      { messageId, mediaType, error: (error as Error).message },
      "Direct download failed, requesting fresh URL via updateMediaMessage",
    );
  }

  // Attempt 2: ask WhatsApp servers for a fresh URL via the socket
  const messageKey = mediaTypeToMessageKey(mediaType);
  const stubMessage = {
    key: { remoteJid: chatJid, id: messageId, fromMe },
    message: {
      [messageKey]: {
        mediaKey: mediaKeyBuffer,
        directPath,
        url: mediaUrl || undefined,
      },
    },
  };

  const updated = await socket.updateMediaMessage(stubMessage as any);
  const updatedMedia = updated.message?.[messageKey as keyof typeof updated.message] as any;

  if (!updatedMedia?.url && !updatedMedia?.directPath) {
    throw new Error(`WhatsApp did not return a fresh URL for message ${messageId}`);
  }

  const stream = await downloadContentFromMessage(
    makeDownloadable(updatedMedia.directPath || directPath, updatedMedia.url),
    baileysMediaType,
  );
  return await toBuffer(stream);
}
