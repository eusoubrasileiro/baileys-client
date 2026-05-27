export { startConnection } from "./connection.js";
export { handleConnectionClose } from "./connection-handler.js";
export { createEventDispatcher } from "./event-dispatcher.js";
export { makeLidResolver } from "./lid.js";
export { downloadMedia } from "./media.js";
export { sendMediaMessage, sendTextMessage } from "./sender.js";
export type {
  BaileysClientConfig,
  BaileysClientHooks,
  Chat,
  ConnectionCloseDeps,
  ConnectionState,
  ConnectionStatus,
  Contact,
  DownloadMediaParams,
  EventDispatcherDeps,
  LidResolver,
  MediaInfo,
  MediaType,
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
  isLidJid,
  mimetypeToExtension,
  normalizeJid,
  parseMessage,
  phoneToJid,
} from "./utils.js";
