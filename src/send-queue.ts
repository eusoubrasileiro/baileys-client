import type { Logger } from "pino";
import { sendMediaMessage, sendTextMessage } from "./sender.js";
import type {
  MediaPayload,
  SendOptions,
  SendQueue,
  SendQueueConfig,
  SendResult,
  WhatsAppSocket,
} from "./types.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomDelay(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Creates a serial send queue with configurable inter-message delay.
 * Messages are sent one at a time with randomized jitter between sends
 * to avoid WhatsApp rate limits and bans.
 *
 * Inspired by Evolution API's approach — adds built-in rate limiting
 * that Evolution API recommends but doesn't include.
 */
export function createSendQueue(
  socket: WhatsAppSocket,
  logger: Logger,
  config?: SendQueueConfig,
): SendQueue {
  const minDelay = config?.minDelayMs ?? 1000;
  const maxDelay = config?.maxDelayMs ?? 3000;
  let queue: Promise<void> = Promise.resolve();
  let pendingCount = 0;
  let disposed = false;

  function enqueue(fn: () => Promise<SendResult>): Promise<SendResult> {
    if (disposed) {
      return Promise.resolve({ success: false, error: "Send queue is disposed" });
    }

    pendingCount++;

    let resolveTask!: (value: SendResult) => void;
    const taskPromise = new Promise<SendResult>((resolve) => {
      resolveTask = resolve;
    });

    queue = queue.then(async () => {
      try {
        const result = await fn();
        resolveTask(result);
      } catch (err) {
        resolveTask({
          success: false,
          error: err instanceof Error ? err.message : String(err),
        });
      } finally {
        pendingCount--;
        // Inter-message delay with jitter to appear more human
        if (pendingCount > 0) {
          await sleep(randomDelay(minDelay, maxDelay));
        }
      }
    });

    return taskPromise;
  }

  return {
    sendText(jid: string, text: string, options?: SendOptions): Promise<SendResult> {
      return enqueue(() => sendTextMessage(socket, jid, text, logger, options));
    },
    sendMedia(jid: string, media: MediaPayload, options?: SendOptions): Promise<SendResult> {
      return enqueue(() => sendMediaMessage(socket, jid, media, logger, options));
    },
    get pending(): number {
      return pendingCount;
    },
    dispose(): void {
      disposed = true;
    },
  };
}
