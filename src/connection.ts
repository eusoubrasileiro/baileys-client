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
          connectionState.status = "connected";
          connectionState.qrCode = null;
          connectionState.qrAscii = null;
          connectionState.user = sock.user.name ?? null;
          logger.info(`Connection opened. WA user: ${sock.user.name}`);
          await hooks?.onConnected?.({ id: sock.user.id, name: sock.user.name ?? undefined });

          // Sync group metadata
          try {
            const groups = await sock.groupFetchAllParticipating();
            await hooks?.onGroupsSync?.(groups);
          } catch (err) {
            logger.warn({ err }, "Failed to sync group metadata");
          }
        } else {
          connectionState.status = "connecting";
          logger.info("Connection opened but waiting for user info...");
        }
      }
    }

    if (events["creds.update"] && !isLogout) {
      await saveCreds();
      logger.info("Credentials saved.");
    }

    if (events["messaging-history.set"]) {
      const { chats, contacts, messages } = events["messaging-history.set"];
      await hooks?.onHistorySync?.({ chats, contacts, messages });
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
