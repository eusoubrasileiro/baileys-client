import { defaultReconnectionStrategy } from "./reconnection-strategy.js";
import type { ConnectionCloseDeps } from "./types.js";

export function handleConnectionClose(
  statusCode: number | undefined,
  lastError: Error | undefined,
  reasonName: string,
  deps: ConnectionCloseDeps,
): void {
  const { logger, connectionState, socketState } = deps;
  const strategy = deps.strategy ?? defaultReconnectionStrategy();

  // Reset connection state — independent of retry policy.
  connectionState.status = "disconnected";
  connectionState.qrCode = null;
  connectionState.qrAscii = null;
  connectionState.user = null;
  socketState.socket = null;

  logger.warn({ err: lastError }, `Connection closed. Reason: ${reasonName}`);

  const decision = strategy.decide(statusCode, lastError);

  if (decision === "giveup") {
    logger.warn("Reconnection strategy returned 'giveup'. Staying disconnected.");
    return;
  }

  if (decision === "reconnect") {
    // `randomize` is part of the strategy interface for forward-compatibility
    // but the deps' `pRetryFn` type does not accept it today. Forwarding it
    // would require modifying an existing `ConnectionCloseDeps` field — off
    // limits for this iteration (sibling-agent merge hazard).
    const { retries, minTimeout, maxTimeout, factor } = strategy.getRetryOptions();
    deps
      .pRetryFn(() => deps.startConnection(), {
        retries,
        minTimeout,
        maxTimeout,
        factor,
        onFailedAttempt: (err) => {
          logger.warn(
            `Reconnect attempt ${err.attemptNumber} failed, ${err.retriesLeft} retries left`,
          );
        },
      })
      .catch((err) => {
        logger.error({ err }, "All reconnection attempts failed.");
      });
    return;
  }

  // decision === "logout": clear credentials and reconnect after delay.
  logger.warn("Logged out from WhatsApp. Clearing credentials and reconnecting...");
  deps.rmSync(deps.authDir, { recursive: true, force: true });
  deps.mkdirSync(deps.authDir, { recursive: true });
  deps.setTimeoutFn(() => {
    deps.startConnection().catch((err) => {
      logger.error({ err }, "Failed to restart connection after logout");
    });
  }, 2000);
}
