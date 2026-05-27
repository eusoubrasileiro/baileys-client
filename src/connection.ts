import fs from "node:fs";
import {
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  makeWASocket,
  useMultiFileAuthState,
} from "@whiskeysockets/baileys";
import pRetry from "p-retry";
import { handleConnectionClose } from "./connection-handler.js";
import { createEventDispatcher } from "./event-dispatcher.js";
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
    // Baileys rc.9 calls this from `handleNotification` without an existence
    // guard — passing `undefined` crashes with `TypeError: shouldIgnoreJid is
    // not a function` in a reconnect loop. The previous default
    // `(jid) => isJidGroup(jid)` silently NACKed every `@g.us` message at
    // messages-recv.js:847/916/950, leaving group ingest broken in a way the
    // history-sync backfill masked until WhatsApp's LID rollout stopped
    // replaying groups. Explicit `() => false` keeps the runtime happy and
    // lets every JID flow.
    shouldIgnoreJid: config.shouldIgnoreJid ?? (() => false),
    syncFullHistory: config.syncFullHistory ?? true,
  });

  socketState.socket = sock;

  const inactivityTimeoutMs =
    config.historySyncInactivityTimeoutMs ?? config.historySyncTimeoutMs ?? 60_000;

  async function syncGroupMetadata(): Promise<void> {
    try {
      const groups = await sock.groupFetchAllParticipating();
      await hooks?.onGroupsSync?.(groups);
    } catch (err) {
      logger.warn({ err }, "Failed to sync group metadata");
    }
  }

  const dispatch = createEventDispatcher({
    connectionState,
    socketState,
    hooks,
    logger,
    saveCreds,
    getSocketUser: () => sock.user ?? null,
    syncGroupMetadata,
    generateAsciiQRFn: generateAsciiQR,
    inactivityTimeoutMs,
    onClose: (statusCode, error, reason) => {
      handleConnectionClose(statusCode, error, reason, {
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
      });
    },
  });

  sock.ev.process(dispatch);

  return sock;
}
