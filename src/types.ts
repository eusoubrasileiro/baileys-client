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

export type ConnectionStatus = "disconnected" | "qr_pending" | "connecting" | "connected";

export type ConnectionState = {
  status: ConnectionStatus;
  qrCode: string | null;
  qrAscii: string | null;
  user: string | null;
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

export type SendResult = {
  success: boolean;
  messageId?: string;
  error?: string;
};

export type SendOptions = {
  /** Delay in ms before sending. Shows "composing" presence to the recipient. */
  delay?: number;
};

export type MediaPayload = {
  buffer: Buffer;
  type: "image" | "video" | "document" | "audio";
  caption?: string;
  fileName?: string;
  mimetype?: string;
};

export type SendQueueConfig = {
  /** Minimum delay between consecutive messages in ms. Default: 1000 */
  minDelayMs?: number;
  /** Maximum delay between consecutive messages in ms (adds random jitter). Default: 3000 */
  maxDelayMs?: number;
};

export type SendQueue = {
  sendText: (jid: string, text: string, options?: SendOptions) => Promise<SendResult>;
  sendMedia: (jid: string, media: MediaPayload, options?: SendOptions) => Promise<SendResult>;
  /** Number of messages waiting in the queue */
  readonly pending: number;
  /** Stop accepting new messages */
  dispose: () => void;
};

export type BaileysClientHooks = {
  onQrCode?: (qr: string, ascii: string) => void | Promise<void>;
  onConnecting?: () => void | Promise<void>;
  onConnected?: (user: { id: string; name?: string }) => void | Promise<void>;
  onDisconnected?: () => void | Promise<void>;
  onReconnectionFailed?: (error: Error) => void | Promise<void>;
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
  }) => void | Promise<void>;
  onGroupsSync?: (
    groups: Record<string, import("@whiskeysockets/baileys").GroupMetadata>,
  ) => void | Promise<void>;
};

export type BaileysClientConfig = {
  authDir: string;
  logger: Logger;
  hooks?: BaileysClientHooks;
  shouldIgnoreJid?: (jid: string) => boolean;
  generateHighQualityLinkPreview?: boolean;
};

export type ConnectionCloseDeps = {
  logger: Logger;
  connectionState: ConnectionState;
  socketState: SocketState;
  hooks?: BaileysClientHooks;
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
