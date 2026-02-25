export { startConnection } from "./connection.js";
export { handleConnectionClose } from "./connection-handler.js";
export { createSendQueue } from "./send-queue.js";
export { sendMediaMessage, sendTextMessage } from "./sender.js";
export type {
  BaileysClientConfig,
  BaileysClientHooks,
  Chat,
  ConnectionCloseDeps,
  ConnectionState,
  ConnectionStatus,
  Contact,
  MediaInfo,
  MediaPayload,
  ParsedMessage,
  SendOptions,
  SendQueue,
  SendQueueConfig,
  SendResult,
  SocketState,
  WAMessage,
  WAMessageUpdate,
  WhatsAppSocket,
} from "./types.js";
export {
  extractMediaInfo,
  generateAsciiQR,
  isGroupJid,
  mimetypeToExtension,
  normalizeJid,
  parseMessage,
  phoneToJid,
} from "./utils.js";
