import type { Readable } from "node:stream";
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
 *
 * Two layers of retry for expired CDN URLs:
 * 1. Baileys' built-in: downloadMediaMessage calls reuploadRequest on HTTP 410/404.
 * 2. Our catch-all: on any other failure (connection errors, 403, 500, etc.)
 *    we manually call socket.updateMediaMessage() and retry once.
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

  const options = { logger, reuploadRequest: socket.updateMediaMessage };

  let result: Buffer | Readable;
  try {
    result = await downloadMediaMessage(msg as any, "buffer", {}, options);
  } catch (error) {
    // Baileys only retries on HTTP 410/404. Expired CDN URLs can also fail
    // with connection errors or other HTTP codes — manually refresh and retry.
    logger.info({ messageId, err: error }, "Download failed, requesting fresh URL and retrying");
    const refreshed = await socket.updateMediaMessage(msg as any);
    result = await downloadMediaMessage(refreshed, "buffer", {}, options);
  }

  return Buffer.isBuffer(result) ? result : await toBuffer(result as any);
}
