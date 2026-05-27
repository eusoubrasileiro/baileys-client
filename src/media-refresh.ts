import type { Readable } from "node:stream";
import { downloadMediaMessage, toBuffer } from "@whiskeysockets/baileys";
import type { MediaRefreshAdapter, MediaRefreshContext } from "./types.js";

/**
 * Default {@link MediaRefreshAdapter} — preserves historic behaviour:
 *
 * 1. Call `socket.updateMediaMessage(message)` to ask WhatsApp to re-upload
 *    the media and hand back a freshly-signed URL.
 * 2. Re-issue `downloadMediaMessage` against the refreshed message exactly
 *    once. If that still fails, the error propagates.
 *
 * Returned as a factory (rather than a const) to mirror the rest of the
 * library's DI-friendly style and to leave room for future per-instance
 * configuration without breaking the public type.
 */
export function defaultMediaRefreshAdapter(): MediaRefreshAdapter {
  return {
    async refreshAndRetry(message: unknown, ctx: MediaRefreshContext): Promise<Buffer> {
      const { socket, logger, messageId, originalError } = ctx;
      logger.info(
        { messageId, err: originalError },
        "Download failed, requesting fresh URL and retrying",
      );
      const refreshed = await socket.updateMediaMessage(message as any);
      const result: Buffer | Readable = await downloadMediaMessage(
        refreshed as any,
        "buffer",
        {},
        { logger, reuploadRequest: socket.updateMediaMessage },
      );
      return Buffer.isBuffer(result) ? result : await toBuffer(result as any);
    },
  };
}
