import type { WAMessage } from "@whiskeysockets/baileys";

/**
 * Baileys envelope (already unwrapped from view-once / ephemeral /
 * documentWithCaption layers by `normalizeMessageContent`).
 */
export type MessageContent = NonNullable<WAMessage["message"]>;

/**
 * Per-type content extractor. Returns the rendered preview string for one
 * Baileys message variant, or `null` when this extractor doesn't apply
 * (e.g. the field is missing).
 */
export type MessageContentExtractor = (content: MessageContent) => string | null;

/**
 * Ordered registry: first extractor returning a non-null string wins.
 * Order matters — `parseMessage` historically prefers caption-bearing media
 * over their bare fallbacks, and prefers text envelopes over media.
 */
const captionExtractors: MessageContentExtractor[] = [
  (m) => m.conversation ?? null,
  (m) => m.extendedTextMessage?.text ?? null,
  (m) => (m.imageMessage?.caption ? `[Image] ${m.imageMessage.caption}` : null),
  (m) => (m.videoMessage?.caption ? `[Video] ${m.videoMessage.caption}` : null),
  (m) => {
    const doc = m.documentMessage;
    if (!doc) return null;
    if (!doc.caption && !doc.fileName) return null;
    return `[Document] ${doc.caption || doc.fileName || ""}`;
  },
  (m) => (m.audioMessage ? "[Audio]" : null),
  (m) => (m.stickerMessage ? "[Sticker]" : null),
  (m) => (m.locationMessage?.address ? `[Location] ${m.locationMessage.address}` : null),
  (m) => (m.contactMessage?.displayName ? `[Contact] ${m.contactMessage.displayName}` : null),
  (m) => (m.pollCreationMessage?.name ? `[Poll] ${m.pollCreationMessage.name}` : null),
];

/**
 * Bare-media fallbacks used when none of the caption-bearing branches
 * matched but the envelope still carries a media field. Mirrors the legacy
 * fallback block in `parseMessage`.
 */
const fallbackExtractors: MessageContentExtractor[] = [
  (m) => (m.imageMessage ? "[Image]" : null),
  (m) => (m.videoMessage ? "[Video]" : null),
  (m) => (m.documentMessage ? "[Document]" : null),
  (m) => (m.audioMessage ? "[Audio]" : null),
];

/**
 * Render a human-readable preview string for a Baileys message envelope.
 *
 * The caller is responsible for unwrapping view-once / ephemeral /
 * documentWithCaption layers first (Baileys' `normalizeMessageContent`
 * does this).
 */
export function extractMessageContent(content: MessageContent | null | undefined): string | null {
  if (!content) return null;

  for (const extractor of captionExtractors) {
    const result = extractor(content);
    if (result) return result;
  }

  for (const extractor of fallbackExtractors) {
    const result = extractor(content);
    if (result) return result;
  }

  return null;
}
