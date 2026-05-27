import type { Readable } from "node:stream";
import { downloadMediaMessage, getUrlFromDirectPath, toBuffer } from "@whiskeysockets/baileys";
import type { Logger } from "pino";
import { defaultMediaRefreshAdapter } from "./media-refresh.js";
import type {
  DownloadMediaParams,
  MediaRefreshAdapter,
  MediaType,
  WhatsAppSocket,
} from "./types.js";

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
 * 1. Baileys' built-in: `downloadMediaMessage` calls `reuploadRequest` on
 *    HTTP 410/404.
 * 2. The {@link MediaRefreshAdapter} seam: on any other failure (connection
 *    errors, 403, 500, etc.) the adapter is invoked to refresh the URL and
 *    retry. The default adapter performs one `socket.updateMediaMessage`
 *    call followed by a single re-download; consumers may inject a custom
 *    adapter to add instrumentation, circuit-breakers, or alternative retry
 *    budgets.
 */
export async function downloadMedia(
  socket: WhatsAppSocket,
  params: DownloadMediaParams,
  logger: Logger,
  adapter: MediaRefreshAdapter = defaultMediaRefreshAdapter(),
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

  try {
    const result: Buffer | Readable = await downloadMediaMessage(
      msg as any,
      "buffer",
      {},
      {
        logger,
        reuploadRequest: socket.updateMediaMessage,
      },
    );
    return Buffer.isBuffer(result) ? result : await toBuffer(result as any);
  } catch (error) {
    // Baileys only retries on HTTP 410/404. Anything else (connection errors,
    // 403, 500, …) lands here; delegate to the refresh adapter.
    return adapter.refreshAndRetry(msg, {
      socket,
      logger,
      messageId,
      originalError: error,
    });
  }
}
