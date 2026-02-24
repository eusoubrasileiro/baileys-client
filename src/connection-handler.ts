import type { ConnectionCloseDeps } from "./types.js";

export function handleConnectionClose(
  statusCode: number | undefined,
  lastError: Error | undefined,
  reasonName: string,
  deps: ConnectionCloseDeps,
): void {
  const { logger, connectionState, socketState } = deps;

  // Reset connection state
  connectionState.status = "disconnected";
  connectionState.qrCode = null;
  connectionState.qrAscii = null;
  connectionState.user = null;
  socketState.socket = null;

  logger.warn({ err: lastError }, `Connection closed. Reason: ${reasonName}`);

  if (statusCode !== deps.loggedOutCode) {
    // Non-logout: retry with exponential backoff
    deps
      .pRetryFn(() => deps.startConnection(), {
        retries: 10,
        minTimeout: 1000,
        maxTimeout: 60000,
        factor: 2,
        onFailedAttempt: (err) => {
          logger.warn(
            `Reconnect attempt ${err.attemptNumber} failed, ${err.retriesLeft} retries left`,
          );
        },
      })
      .catch((err) => {
        logger.error({ err }, "All reconnection attempts failed.");
      });
  } else {
    // Logout: clear credentials and reconnect after delay
    logger.warn("Logged out from WhatsApp. Clearing credentials and reconnecting...");
    deps.rmSync(deps.authDir, { recursive: true, force: true });
    deps.mkdirSync(deps.authDir, { recursive: true });
    deps.setTimeoutFn(() => {
      deps.startConnection().catch((err) => {
        logger.error({ err }, "Failed to restart connection after logout");
      });
    }, 2000);
  }
}
