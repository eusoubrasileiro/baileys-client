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
};
