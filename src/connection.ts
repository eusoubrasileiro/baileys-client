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
import type { Logger } from "pino";
import { handleConnectionClose } from "./connection-handler.js";
import type { BaileysClientConfig, ConnectionState, SocketState, WhatsAppSocket } from "./types.js";
import { generateAsciiQR } from "./utils.js";

async function safeHook(
  fn: (() => void | Promise<void>) | undefined,
  name: string,
  logger: Logger,
): Promise<void> {
  if (!fn) return;
  try {
    await fn();
  } catch (err) {
    logger.error({ err }, `Hook "${name}" threw an error`);
  }
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
    if (events["connection.update"]) {
      const update = events["connection.update"];
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        connectionState.status = "qr_pending";
        connectionState.qrCode = qr;
        const ascii = await generateAsciiQR(qr);
        connectionState.qrAscii = ascii;
        logger.info("QR Code received.");
        await safeHook(() => hooks?.onQrCode?.(qr, ascii), "onQrCode", logger);
      }

      if (connection === "connecting") {
        connectionState.status = "connecting";
        connectionState.qrCode = null;
        connectionState.qrAscii = null;
        await safeHook(() => hooks?.onConnecting?.(), "onConnecting", logger);
      }

      if (connection === "close") {
        const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;
        handleConnectionClose(
          statusCode,
          lastDisconnect?.error as Error | undefined,
          DisconnectReason[statusCode as number] || "Unknown",
          {
            logger,
            connectionState,
            socketState,
            hooks,
            startConnection: () => connectSocket(config, connectionState, socketState),
            rmSync: fs.rmSync,
            mkdirSync: fs.mkdirSync,
            setTimeoutFn: (cb, ms) => setTimeout(cb, ms),
            pRetryFn: pRetry,
            authDir: config.authDir,
            loggedOutCode: DisconnectReason.loggedOut,
          },
        );
        await safeHook(() => hooks?.onDisconnected?.(), "onDisconnected", logger);
      } else if (connection === "open") {
        if (sock.user) {
          connectionState.status = "connected";
          connectionState.qrCode = null;
          connectionState.qrAscii = null;
          connectionState.user = sock.user.name ?? null;
          logger.info(`Connection opened. WA user: ${sock.user.name}`);
          await safeHook(
            () => hooks?.onConnected?.({ id: sock.user!.id, name: sock.user!.name ?? undefined }),
            "onConnected",
            logger,
          );

          // Sync group metadata
          try {
            const groups = await sock.groupFetchAllParticipating();
            await safeHook(() => hooks?.onGroupsSync?.(groups), "onGroupsSync", logger);
          } catch (err) {
            logger.warn({ err }, "Failed to sync group metadata");
          }
        } else {
          connectionState.status = "connecting";
          logger.info("Connection opened but waiting for user info...");
        }
      }
    }

    if (events["creds.update"]) {
      await saveCreds();
      logger.info("Credentials saved.");
    }

    if (events["messaging-history.set"]) {
      const { chats, contacts, messages } = events["messaging-history.set"];
      await safeHook(
        () => hooks?.onHistorySync?.({ chats, contacts, messages }),
        "onHistorySync",
        logger,
      );
    }

    if (events["contacts.upsert"]) {
      const contacts = events["contacts.upsert"];
      logger.info({ count: contacts.length }, "Received contacts.upsert event");
      await safeHook(() => hooks?.onContactsUpsert?.(contacts), "onContactsUpsert", logger);
    }

    if (events["contacts.update"]) {
      const contacts = events["contacts.update"];
      logger.info({ count: contacts.length }, "Received contacts.update event");
      await safeHook(() => hooks?.onContactsUpdate?.(contacts), "onContactsUpdate", logger);
    }

    if (events["messages.upsert"]) {
      const { messages, type } = events["messages.upsert"];
      logger.info({ type, count: messages.length }, "Received messages.upsert event");
      if (type === "notify" || type === "append") {
        await safeHook(() => hooks?.onMessageUpsert?.(messages, type), "onMessageUpsert", logger);
      }
    }

    if (events["messages.update"]) {
      const updates = events["messages.update"];
      await safeHook(() => hooks?.onMessagesUpdate?.(updates), "onMessagesUpdate", logger);
    }

    if (events["chats.update"]) {
      const chatsUpdate = events["chats.update"];
      logger.info({ count: chatsUpdate.length }, "Received chats.update event");
      await safeHook(() => hooks?.onChatsUpdate?.(chatsUpdate), "onChatsUpdate", logger);
    }
  });

  return sock;
}
