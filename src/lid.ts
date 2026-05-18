import type { LidResolver, WhatsAppSocket } from "./types.js";

/**
 * Wrap a connected socket's Baileys LID mapping store in a narrow, typed
 * `LidResolver`. Keeps consumers off Baileys internals
 * (`socket.signalRepository.lidMapping`).
 *
 * Note: `getLIDForPN` is reliable (WhatsApp resolves PN→LID via protocol);
 * `getPNForLID` is best-effort and may return `null` even for a known contact.
 */
export function makeLidResolver(socket: WhatsAppSocket): LidResolver {
  const store = socket.signalRepository.lidMapping;
  return {
    getPNForLID: (lid) => store.getPNForLID(lid),
    getLIDForPN: (pn) => store.getLIDForPN(pn),
  };
}
