import type { makeWASocket } from "@whiskeysockets/baileys";
import type { Logger } from "pino";

// Re-export useful Baileys types consumers need
export type {
  Chat,
  Contact,
  WAMessage,
  WAMessageUpdate,
} from "@whiskeysockets/baileys";

export type WhatsAppSocket = ReturnType<typeof makeWASocket>;

export type ConnectionStatus =
  | "disconnected"
  | "qr_pending"
  | "connecting"
  | "syncing"
  | "connected";

export type SyncProgress = {
  chats: number;
  contacts: number;
  messages: number;
  lastBatchAt: Date | null;
};

export type ConnectionState = {
  status: ConnectionStatus;
  qrCode: string | null;
  qrAscii: string | null;
  user: string | null;
  syncProgress: SyncProgress;
};

export type SocketState = {
  socket: WhatsAppSocket | null;
};

export type MediaInfo = {
  media_type: string;
  mimetype: string | null;
  media_key: string | null;
  direct_path: string | null;
  media_url: string | null;
  file_length: number | null;
  file_sha256: string | null;
  file_enc_sha256: string | null;
};

export type ParsedMessage = {
  id: string;
  chat_jid: string;
  sender: string | null;
  /**
   * The twin JID for `chat_jid` — its `@lid` counterpart if `chat_jid` is a
   * phone-number JID, or vice versa. Sourced from `key.remoteJidAlt`. Lets
   * consumers reconcile the LID↔PN identity pair. `null` when WhatsApp did not
   * supply it.
   */
  chat_jid_alt?: string | null;
  /** The twin JID for `sender`, sourced from `key.participantAlt`. */
  sender_alt?: string | null;
  /** Which JID type WhatsApp prefers for this chat: "pn" or "lid". */
  addressing_mode?: "pn" | "lid" | null;
  content: string;
  timestamp: Date;
  is_from_me: boolean;
  media_type: string | null;
  mimetype: string | null;
  media_key: string | null;
  direct_path: string | null;
  media_url: string | null;
  file_length: number | null;
  file_sha256: string | null;
  file_enc_sha256: string | null;
};

export type BaileysClientHooks = {
  onQrCode?: (qr: string, ascii: string) => void | Promise<void>;
  onConnecting?: () => void | Promise<void>;
  onConnected?: (user: { id: string; name?: string }) => void | Promise<void>;
  onDisconnected?: () => void | Promise<void>;
  onMessageUpsert?: (
    messages: import("@whiskeysockets/baileys").WAMessage[],
    type: "notify" | "append",
  ) => void | Promise<void>;
  onMessagesUpdate?: (
    updates: import("@whiskeysockets/baileys").WAMessageUpdate[],
  ) => void | Promise<void>;
  onContactsUpsert?: (
    contacts: import("@whiskeysockets/baileys").Contact[],
  ) => void | Promise<void>;
  onContactsUpdate?: (
    contacts: Partial<import("@whiskeysockets/baileys").Contact>[],
  ) => void | Promise<void>;
  onChatsUpdate?: (chats: import("@whiskeysockets/baileys").Chat[]) => void | Promise<void>;
  onHistorySync?: (data: {
    chats: import("@whiskeysockets/baileys").Chat[];
    contacts: import("@whiskeysockets/baileys").Contact[];
    messages: import("@whiskeysockets/baileys").WAMessage[];
    isLatest: boolean;
  }) => void | Promise<void>;
  onReady?: () => void | Promise<void>;
  onGroupsSync?: (
    groups: Record<string, import("@whiskeysockets/baileys").GroupMetadata>,
  ) => void | Promise<void>;
  /**
   * Fired when WhatsApp delivers a new LID↔phone-number mapping. Best-effort:
   * WhatsApp does not always emit this, so consumers should also reconcile
   * from `ParsedMessage.chat_jid_alt`.
   */
  onLidMapping?: (mapping: { lid: string; pn: string }) => void | Promise<void>;
};

/**
 * Narrow, typed surface over the socket's Baileys LID mapping store. Resolve a
 * phone-number JID to its LID (`getLIDForPN` — reliable) or the reverse
 * (`getPNForLID` — best-effort; WhatsApp does not always know the PN).
 */
export type LidResolver = {
  getPNForLID: (lid: string) => Promise<string | null>;
  getLIDForPN: (pn: string) => Promise<string | null>;
};

export type BaileysClientConfig = {
  authDir: string;
  logger: Logger;
  hooks?: BaileysClientHooks;
  shouldIgnoreJid?: (jid: string) => boolean;
  generateHighQualityLinkPreview?: boolean;
  syncFullHistory?: boolean;
  /** Inactivity timeout (ms) — resets on each sync batch. Default: 60000. */
  historySyncInactivityTimeoutMs?: number;
  /** @deprecated Use historySyncInactivityTimeoutMs instead. */
  historySyncTimeoutMs?: number;
};

export type MediaType = "image" | "video" | "audio" | "ptt" | "document" | "sticker";

export type DownloadMediaParams = {
  mediaKey: string; // base64-encoded
  directPath: string;
  mediaUrl?: string | null;
  mediaType: MediaType;
  messageId: string;
  chatJid: string;
  fromMe: boolean;
};

/**
 * Dependencies injected into `createEventDispatcher`. Each handler in the
 * dispatcher reads its collaborators from this object — no module-level state.
 * This is the seam that makes per-event behaviour unit-testable in isolation.
 */
export type EventDispatcherDeps = {
  connectionState: ConnectionState;
  socketState: SocketState;
  hooks: BaileysClientHooks | undefined;
  logger: Logger;
  saveCreds: () => Promise<void>;
  /**
   * Late-bound accessor for the socket's `user` field. Baileys populates
   * `sock.user.name` asynchronously after `connection.open`, so handlers must
   * re-read it on each event rather than capture it at construction time.
   */
  getSocketUser: () => { id: string; name?: string | null } | null;
  /**
   * Called by the `connection===close` handler with `(statusCode, error,
   * reason)`. The dispatcher does not know about retry policy or filesystem
   * cleanup — those belong to `handleConnectionClose` in the host module.
   */
  onClose: (statusCode: number | undefined, error: Error | undefined, reason: string) => void;
  /** Side-effect: fetch group metadata + fire `onGroupsSync`. */
  syncGroupMetadata: () => Promise<void>;
  /** Async ASCII QR renderer — injected so tests don't shell out. */
  generateAsciiQRFn: (qr: string) => Promise<string>;
  /** Inactivity timeout (ms) used when waiting for `messaging-history.set` batches. */
  inactivityTimeoutMs: number;
};

/**
 * Context handed to a {@link MediaRefreshAdapter} when the initial media
 * download fails. Carries the socket (for `updateMediaMessage` calls), the
 * logger, the message id (for correlation), and the original error so adapters
 * can decide whether to retry or surface custom telemetry.
 */
export type MediaRefreshContext = {
  socket: WhatsAppSocket;
  logger: Logger;
  messageId: string;
  originalError: unknown;
};

/**
 * Seam for the "expired CDN URL → refresh → retry once" branch of
 * `downloadMedia`. Consumers can supply a custom adapter to add
 * instrumentation, circuit-breakers, or alternative retry budgets without
 * forking the library. The default adapter
 * ({@link import("./media-refresh.js").defaultMediaRefreshAdapter}) preserves
 * historic behaviour: one `socket.updateMediaMessage(msg)` call followed by a
 * single re-download.
 *
 * `message` is the same Baileys message object that was passed to the failed
 * download — adapters may pass it as-is to `socket.updateMediaMessage` to
 * obtain a fresh, signed URL.
 */
export type MediaRefreshAdapter = {
  refreshAndRetry: (message: unknown, ctx: MediaRefreshContext) => Promise<Buffer>;
};

export type { MessageContent, MessageContentExtractor } from "./message-content.js";

/**
 * Coarse classification of an error thrown by `socket.sendMessage`. Surfaced
 * on `SendResult.errorKind` so callers can pick a retry policy without sniffing
 * error-message strings. See `sender-errors.ts` for the matching rules.
 */
export type SenderErrorKind = "transient" | "permanent" | "unknown";

/**
 * Public shape of the value returned by `sendTextMessage` / `sendMediaMessage`.
 * `errorKind` is populated only on failure; `success === true` results omit it.
 */
export type SendResult = {
  success: boolean;
  messageId?: string;
  error?: string;
  errorKind?: SenderErrorKind;
};

export type ConnectionCloseDeps = {
  logger: Logger;
  connectionState: ConnectionState;
  socketState: SocketState;
  startConnection: () => Promise<WhatsAppSocket>;
  rmSync: (path: string, opts: { recursive: boolean; force: boolean }) => void;
  mkdirSync: (path: string, opts: { recursive: boolean }) => void;
  setTimeoutFn: (cb: () => void, ms: number) => void;
  pRetryFn: (
    fn: () => Promise<WhatsAppSocket>,
    opts: {
      retries: number;
      minTimeout: number;
      maxTimeout: number;
      factor: number;
      onFailedAttempt: (err: { attemptNumber: number; retriesLeft: number }) => void;
    },
  ) => Promise<WhatsAppSocket>;
  authDir: string;
  loggedOutCode: number;
  /**
   * Optional reconnection strategy that owns the disconnect-reason decision
   * (`'reconnect' | 'logout' | 'giveup'`) and the p-retry option shape. When
   * absent, `handleConnectionClose` falls back to `defaultReconnectionStrategy`
   * — which preserves the historical 10-retry / 1s→60s exponential policy and
   * the `loggedOut`-only logout rule.
   */
  strategy?: ReconnectionStrategy;
};

/**
 * Reconnection policy seam consumed by `handleConnectionClose`. Splits the two
 * orthogonal questions out of the handler: *whether* to retry (the decision
 * tree over Baileys' `DisconnectReason`) and *how long to wait* between
 * attempts (the p-retry option shape). Lets consumers plug in custom
 * back-off, circuit-breaker, or "give up after N minutes" policies without
 * touching the handler itself.
 */
export type ReconnectionStrategy = {
  /**
   * Inspect the disconnect signal and decide what the handler should do.
   * Return `'logout'` to clear credentials and reconnect, `'reconnect'` to
   * retry without touching creds, or `'giveup'` to stop entirely.
   */
  decide: (
    statusCode: number | undefined,
    error: Error | undefined,
  ) => "reconnect" | "logout" | "giveup";
  /**
   * p-retry options used by the handler when `decide` returns `'reconnect'`.
   * `onFailedAttempt` is supplied by the handler; everything else comes from
   * the strategy.
   */
  getRetryOptions: () => {
    retries: number;
    minTimeout: number;
    maxTimeout: number;
    factor: number;
    randomize: boolean;
  };
};
