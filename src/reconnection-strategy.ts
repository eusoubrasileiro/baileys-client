import { DisconnectReason } from "@whiskeysockets/baileys";
import type { ReconnectionStrategy } from "./types.js";

/**
 * Fallback per-attempt cap. Also applied by `handleConnectionClose` to
 * strategies that predate `getAttemptTimeoutMs`.
 */
export const DEFAULT_ATTEMPT_TIMEOUT_MS = 60_000;

/**
 * Default `ReconnectionStrategy`: preserves the historical behaviour of
 * `handleConnectionClose`. `DisconnectReason.loggedOut` triggers a `'logout'`
 * (clear creds and reconnect); every other reason — including `undefined` —
 * triggers `'reconnect'` with 10 attempts, exponential 1s→60s backoff, factor
 * 2, randomized, each attempt capped at 60s.
 */
export function defaultReconnectionStrategy(): ReconnectionStrategy {
  return {
    decide(statusCode) {
      if (statusCode === DisconnectReason.loggedOut) {
        return "logout";
      }
      return "reconnect";
    },
    getRetryOptions() {
      return {
        retries: 10,
        minTimeout: 1000,
        maxTimeout: 60_000,
        factor: 2,
        randomize: true,
      };
    },
    getAttemptTimeoutMs() {
      return DEFAULT_ATTEMPT_TIMEOUT_MS;
    },
  };
}
