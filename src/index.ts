export { startConnection } from "./connection.js";
export { handleConnectionClose } from "./connection-handler.js";
export { downloadMedia, sendMediaMessage, sendTextMessage } from "./sender.js";
export type {
  BaileysClientConfig,
  BaileysClientHooks,
  Chat,
  ConnectionCloseDeps,
  ConnectionState,
  ConnectionStatus,
  Contact,
  DownloadMediaParams,
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
