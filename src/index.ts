export { startConnection } from "./connection.js";
export { handleConnectionClose } from "./connection-handler.js";
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
  ParsedMessage,
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
