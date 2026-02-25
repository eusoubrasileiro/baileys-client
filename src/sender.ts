import { jidNormalizedUser } from "@whiskeysockets/baileys";
import type { Logger } from "pino";
import type { MediaPayload, SendOptions, SendResult, WhatsAppSocket } from "./types.js";

const TYPING_CHUNK_MS = 20_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Simulate typing presence before sending a message.
 * Inspired by Evolution API: chunks long delays into 20s "composing" intervals.
 */
async function simulatePresence(
  socket: WhatsAppSocket,
  jid: string,
  delayMs: number,
  logger: Logger,
): Promise<void> {
  try {
    await socket.presenceSubscribe(jid);
    let remaining = delayMs;
    while (remaining > 0) {
      await socket.sendPresenceUpdate("composing", jid);
      const chunk = Math.min(remaining, TYPING_CHUNK_MS);
      await sleep(chunk);
      remaining -= chunk;
    }
    await socket.sendPresenceUpdate("paused", jid);
  } catch (err) {
    // Presence failure should not block sending
    logger.warn({ err, jid }, "Failed to simulate typing presence");
  }
}

export async function sendTextMessage(
  socket: WhatsAppSocket,
  jid: string,
  text: string,
  logger: Logger,
  options?: SendOptions,
): Promise<SendResult> {
  if (!socket.user) {
    return { success: false, error: "WhatsApp socket not connected" };
  }
  try {
    const normalizedJid = jidNormalizedUser(jid);
    if (options?.delay) {
      await simulatePresence(socket, normalizedJid, options.delay, logger);
    }
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
  media: MediaPayload,
  logger: Logger,
  options?: SendOptions,
): Promise<SendResult> {
  if (!socket.user) {
    return { success: false, error: "WhatsApp socket not connected" };
  }
  try {
    const normalizedJid = jidNormalizedUser(jid);
    if (options?.delay) {
      await simulatePresence(socket, normalizedJid, options.delay, logger);
    }

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
