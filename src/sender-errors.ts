/**
 * Classify thrown Baileys/socket errors so callers can decide whether a retry
 * is sensible (transient) or wasted effort (permanent). Anything not on either
 * list is `unknown` — callers should treat it as "don't know, be conservative".
 *
 * The match is intentionally narrow: a fixed token list against the lowercased
 * `Error.message`, plus a Boom-style `error.output.statusCode` lookup. No
 * regex catalogues, no retry-budget bookkeeping — those live in the caller.
 */

export type SenderErrorKind = "transient" | "permanent" | "unknown";

const PERMANENT_TOKENS = [
  "not-authorized",
  "bad-request",
  "forbidden",
  "recipient-not-found",
  "payload-too-large",
];

const TRANSIENT_TOKENS = [
  "timeout",
  "econnreset",
  "econnrefused",
  "enotfound",
  "network-error",
  "connection-closed",
  "stream-conflict",
];

const PERMANENT_STATUS_CODES = new Set([400, 401, 403, 404, 413]);
const TRANSIENT_STATUS_CODES = new Set([408, 503]);

export function classifySenderError(err: unknown): SenderErrorKind {
  if (!err || typeof err !== "object") {
    return "unknown";
  }

  const statusCode = (err as { output?: { statusCode?: unknown } }).output?.statusCode;
  if (typeof statusCode === "number") {
    if (PERMANENT_STATUS_CODES.has(statusCode)) return "permanent";
    if (TRANSIENT_STATUS_CODES.has(statusCode)) return "transient";
  }

  const rawMessage = (err as { message?: unknown }).message;
  if (typeof rawMessage === "string") {
    const message = rawMessage.toLowerCase();
    if (PERMANENT_TOKENS.some((t) => message.includes(t))) return "permanent";
    if (TRANSIENT_TOKENS.some((t) => message.includes(t))) return "transient";
  }

  return "unknown";
}
