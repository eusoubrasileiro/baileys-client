import fs from "node:fs";
import {
  DisconnectReason,
  fetchLatestBaileysVersion,
  isJidGroup,
  makeCacheableSignalKeyStore,
  makeWASocket,
  useMultiFileAuthState,
} from "@whiskeysockets/baileys";
import pRetry from "p-retry";
import { handleConnectionClose } from "./connection-handler.js";
import type { BaileysClientConfig, ConnectionState, SocketState, WhatsAppSocket } from "./types.js";
import { generateAsciiQR } from "./utils.js";

/**
 * Prefer the display name when Baileys has populated it; otherwise fall back
 * to the phone-number portion of the JID (stripping the `:device` suffix and
 * `@s.whatsapp.net`). Prevents "Linked as ?" style UI regressions when callers
 * render `connectionState.user` on first pair, where `sock.user.name` arrives
 * a few events after `connection.open`.
 */
function deriveUserDisplay(user: { id: string; name?: string | null }): string {
  if (user.name) return user.name;
  return user.id.split(/[@:]/)[0] ?? user.id;
}

export async function startConnection(config: BaileysClientConfig): Promise<{
  socket: WhatsAppSocket;
  connectionState: ConnectionState;
  socketState: SocketState;
}> {
  const connectionState: ConnectionState = {
    status: "disconnected",
    qrCode: null,
    qrAscii: null,
    user: null,
    syncProgress: { chats: 0, contacts: 0, messages: 0, lastBatchAt: null },
  };

  const socketState: SocketState = {
    socket: null,
  };

  const socket = await connectSocket(config, connectionState, socketState);

  return { socket, connectionState, socketState };
}

async function connectSocket(
  config: BaileysClientConfig,
  connectionState: ConnectionState,
  socketState: SocketState,
): Promise<WhatsAppSocket> {
  const { logger, hooks } = config;
  const { state, saveCreds } = await useMultiFileAuthState(config.authDir);
  const { version, isLatest } = await fetchLatestBaileysVersion();
  logger.info(`Using WA v${version.join(".")}, isLatest: ${isLatest}`);

  const sock = makeWASocket({
    version,
    logger,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger),
    },
    generateHighQualityLinkPreview: config.generateHighQualityLinkPreview ?? true,
    shouldIgnoreJid: config.shouldIgnoreJid ?? ((jid) => isJidGroup(jid)),
  });

  socketState.socket = sock;

  let syncTimeout: ReturnType<typeof setTimeout> | null = null;
  const inactivityTimeoutMs =
    config.historySyncInactivityTimeoutMs ?? config.historySyncTimeoutMs ?? 60_000;

  async function syncGroupMetadata() {
    try {
      const groups = await sock.groupFetchAllParticipating();
      await hooks?.onGroupsSync?.(groups);
    } catch (err) {
      logger.warn({ err }, "Failed to sync group metadata");
    }
  }

  sock.ev.process(async (events) => {
    let isLogout = false;

    if (events["connection.update"]) {
      const update = events["connection.update"];
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        connectionState.status = "qr_pending";
        connectionState.qrCode = qr;
        connectionState.qrAscii = await generateAsciiQR(qr);
        logger.info("QR Code received.");
        await hooks?.onQrCode?.(qr, connectionState.qrAscii);
      }

      if (connection === "connecting") {
        connectionState.status = "connecting";
        connectionState.qrCode = null;
        connectionState.qrAscii = null;
        await hooks?.onConnecting?.();
      }

      if (connection === "close") {
        if (syncTimeout) {
          clearTimeout(syncTimeout);
          syncTimeout = null;
        }
        const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;
        isLogout = statusCode === DisconnectReason.loggedOut;
        handleConnectionClose(
          statusCode,
          lastDisconnect?.error as Error | undefined,
          DisconnectReason[statusCode as number] || "Unknown",
          {
            logger,
            connectionState,
            socketState,
            startConnection: () => connectSocket(config, connectionState, socketState),
            rmSync: fs.rmSync,
            mkdirSync: fs.mkdirSync,
            setTimeoutFn: (cb, ms) => setTimeout(cb, ms),
            pRetryFn: pRetry,
            authDir: config.authDir,
            loggedOutCode: DisconnectReason.loggedOut,
          },
        );
        await hooks?.onDisconnected?.();
      } else if (connection === "open") {
        if (sock.user) {
          connectionState.status = "syncing";
          connectionState.qrCode = null;
          connectionState.qrAscii = null;
          connectionState.user = deriveUserDisplay(sock.user);
          connectionState.syncProgress = { chats: 0, contacts: 0, messages: 0, lastBatchAt: null };
          logger.info(`Connection opened. WA user: ${connectionState.user}. Waiting for history sync...`);
          await hooks?.onConnected?.({ id: sock.user.id, name: sock.user.name ?? undefined });

          // Fallback: promote to "connected" if no history sync batches arrive
          syncTimeout = setTimeout(() => {
            if (connectionState.status === "syncing") {
              logger.info("History sync inactivity timeout — promoting to connected");
              connectionState.status = "connected";
              hooks?.onReady?.();
              syncGroupMetadata();
            }
          }, inactivityTimeoutMs);
        } else {
          connectionState.status = "connecting";
          logger.info("Connection opened but waiting for user info...");
        }
      }
    }

    if (events["creds.update"] && !isLogout) {
      await saveCreds();
      logger.info("Credentials saved.");
      // Upgrade the display name if Baileys populated sock.user.name after the
      // initial connection.open (common on first pair: .id is present, .name
      // arrives later via a creds update).
      if (sock.user) {
        connectionState.user = deriveUserDisplay(sock.user);
      }
    }

    if (events["messaging-history.set"]) {
      const { chats, contacts, messages, isLatest } = events["messaging-history.set"];
      await hooks?.onHistorySync?.({ chats, contacts, messages, isLatest: isLatest ?? false });

      // Track sync progress
      connectionState.syncProgress.chats += chats.length;
      connectionState.syncProgress.contacts += contacts.length;
      connectionState.syncProgress.messages += messages.length;
      connectionState.syncProgress.lastBatchAt = new Date();

      if (connectionState.status === "syncing") {
        if (syncTimeout) {
          clearTimeout(syncTimeout);
          syncTimeout = null;
        }

        if (isLatest) {
          connectionState.status = "connected";
          logger.info("History sync complete — status is now connected");
          await hooks?.onReady?.();
          await syncGroupMetadata();
        } else {
          // More batches expected — reset inactivity timeout
          logger.info(
            { progress: connectionState.syncProgress },
            "History sync batch received, resetting inactivity timeout",
          );
          syncTimeout = setTimeout(() => {
            if (connectionState.status === "syncing") {
              logger.info("History sync inactivity timeout — promoting to connected");
              connectionState.status = "connected";
              hooks?.onReady?.();
              syncGroupMetadata();
            }
          }, inactivityTimeoutMs);
        }
      }
    }

    if (events["contacts.upsert"]) {
      const contacts = events["contacts.upsert"];
      logger.info({ count: contacts.length }, "Received contacts.upsert event");
      await hooks?.onContactsUpsert?.(contacts);
    }

    if (events["contacts.update"]) {
      const contacts = events["contacts.update"];
      logger.info({ count: contacts.length }, "Received contacts.update event");
      await hooks?.onContactsUpdate?.(contacts);
    }

    if (events["messages.upsert"]) {
      const { messages, type } = events["messages.upsert"];
      logger.info({ type, count: messages.length }, "Received messages.upsert event");
      if (type === "notify" || type === "append") {
        await hooks?.onMessageUpsert?.(messages, type);
      }
    }

    if (events["messages.update"]) {
      const updates = events["messages.update"];
      await hooks?.onMessagesUpdate?.(updates);
    }

    if (events["chats.update"]) {
      logger.info({ count: events["chats.update"].length }, "Received chats.update event");
      await hooks?.onChatsUpdate?.(events["chats.update"]);
    }
  });

  return sock;
}
