import { downloadMediaMessage, getUrlFromDirectPath, toBuffer } from "@whiskeysockets/baileys";
import type { Logger } from "pino";
import type { DownloadMediaParams, MediaType, WhatsAppSocket } from "./types.js";

function mediaTypeToMessageKey(mediaType: MediaType): string {
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
    default: {
      const _exhaustive: never = mediaType;
      throw new Error(`Unknown media type: ${_exhaustive}`);
    }
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
