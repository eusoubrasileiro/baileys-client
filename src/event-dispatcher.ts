import { DisconnectReason } from "@whiskeysockets/baileys";
import type { EventDispatcherDeps } from "./types.js";

/**
 * Prefer the display name when Baileys has populated it; otherwise fall back
 * to the phone-number portion of the JID (stripping the `:device` suffix and
 * `@s.whatsapp.net`). Prevents "Linked as ?" style UI regressions on first
 * pair, where `sock.user.name` arrives a few events after `connection.open`.
 */
function deriveUserDisplay(user: { id: string; name?: string | null }): string {
  if (user.name) return user.name;
  return user.id.split(/[@:]/)[0] ?? user.id;
}

/**
 * Build the function that `sock.ev.process(...)` will receive. The returned
 * dispatcher reads collaborators from the `deps` closure and routes each
 * Baileys event-key to a small, focused handler. The sync inactivity timer is
 * owned here so handlers can reset/clear it without crossing module
 * boundaries.
 */
export function createEventDispatcher(
  deps: EventDispatcherDeps,
): (events: Record<string, any>) => Promise<void> {
  const {
    connectionState,
    hooks,
    logger,
    saveCreds,
    getSocketUser,
    onClose,
    syncGroupMetadata,
    generateAsciiQRFn,
    inactivityTimeoutMs,
  } = deps;

  let syncTimeout: ReturnType<typeof setTimeout> | null = null;

  function clearSyncTimeout(): void {
    if (syncTimeout) {
      clearTimeout(syncTimeout);
      syncTimeout = null;
    }
  }

  function scheduleSyncTimeout(): void {
    clearSyncTimeout();
    syncTimeout = setTimeout(() => {
      if (connectionState.status === "syncing") {
        logger.info("History sync inactivity timeout — promoting to connected");
        connectionState.status = "connected";
        hooks?.onReady?.();
        syncGroupMetadata();
      }
    }, inactivityTimeoutMs);
  }

  async function handleConnectionUpdate(update: any): Promise<{ isLogout: boolean }> {
    const { connection, lastDisconnect, qr } = update;
    let isLogout = false;

    if (qr) {
      connectionState.status = "qr_pending";
      connectionState.qrCode = qr;
      connectionState.qrAscii = await generateAsciiQRFn(qr);
      logger.info("QR Code received.");
      await hooks?.onQrCode?.(qr, connectionState.qrAscii);
    }

    if (connection === "connecting") {
      connectionState.status = "connecting";
      connectionState.qrCode = null;
      connectionState.qrAscii = null;
      await hooks?.onConnecting?.();
    }

    if (connection === "close") {
      clearSyncTimeout();
      const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;
      isLogout = statusCode === DisconnectReason.loggedOut;
      onClose(
        statusCode,
        lastDisconnect?.error as Error | undefined,
        DisconnectReason[statusCode as number] || "Unknown",
      );
      await hooks?.onDisconnected?.();
    } else if (connection === "open") {
      const sockUser = getSocketUser();
      if (sockUser) {
        connectionState.status = "syncing";
        connectionState.qrCode = null;
        connectionState.qrAscii = null;
        connectionState.user = deriveUserDisplay(sockUser);
        connectionState.syncProgress = { chats: 0, contacts: 0, messages: 0, lastBatchAt: null };
        logger.info(
          `Connection opened. WA user: ${connectionState.user}. Waiting for history sync...`,
        );
        await hooks?.onConnected?.({ id: sockUser.id, name: sockUser.name ?? undefined });

        // Fallback: promote to "connected" if no history sync batches arrive
        scheduleSyncTimeout();
      } else {
        connectionState.status = "connecting";
        logger.info("Connection opened but waiting for user info...");
      }
    }

    return { isLogout };
  }

  async function handleCredsUpdate(): Promise<void> {
    await saveCreds();
    logger.info("Credentials saved.");
    // Upgrade the display name if Baileys populated sock.user.name after the
    // initial connection.open (common on first pair: .id is present, .name
    // arrives later via a creds update).
    const sockUser = getSocketUser();
    if (sockUser) {
      connectionState.user = deriveUserDisplay(sockUser);
    }
  }

  async function handleMessagingHistorySet(payload: any): Promise<void> {
    const { chats, contacts, messages, isLatest } = payload;
    await hooks?.onHistorySync?.({ chats, contacts, messages, isLatest: isLatest ?? false });

    // Track sync progress
    connectionState.syncProgress.chats += chats.length;
    connectionState.syncProgress.contacts += contacts.length;
    connectionState.syncProgress.messages += messages.length;
    connectionState.syncProgress.lastBatchAt = new Date();

    if (connectionState.status === "syncing") {
      clearSyncTimeout();

      if (isLatest) {
        connectionState.status = "connected";
        logger.info("History sync complete — status is now connected");
        await hooks?.onReady?.();
        await syncGroupMetadata();
      } else {
        // More batches expected — reset inactivity timeout
        logger.info(
          { progress: connectionState.syncProgress },
          "History sync batch received, resetting inactivity timeout",
        );
        scheduleSyncTimeout();
      }
    }
  }

  async function handleContactsUpsert(contacts: any[]): Promise<void> {
    logger.info({ count: contacts.length }, "Received contacts.upsert event");
    await hooks?.onContactsUpsert?.(contacts);
  }

  async function handleContactsUpdate(contacts: any[]): Promise<void> {
    logger.info({ count: contacts.length }, "Received contacts.update event");
    await hooks?.onContactsUpdate?.(contacts);
  }

  async function handleMessagesUpsert(payload: any): Promise<void> {
    const { messages, type } = payload;
    logger.info({ type, count: messages.length }, "Received messages.upsert event");
    if (type === "notify" || type === "append") {
      await hooks?.onMessageUpsert?.(messages, type);
    }
  }

  async function handleMessagesUpdate(updates: any[]): Promise<void> {
    await hooks?.onMessagesUpdate?.(updates);
  }

  async function handleChatsUpdate(chats: any[]): Promise<void> {
    logger.info({ count: chats.length }, "Received chats.update event");
    await hooks?.onChatsUpdate?.(chats);
  }

  async function handleLidMapping(mapping: { lid: string; pn: string }): Promise<void> {
    logger.info({ mapping }, "Received lid-mapping.update event");
    await hooks?.onLidMapping?.(mapping);
  }

  return async function dispatch(events: Record<string, any>): Promise<void> {
    let isLogout = false;

    if (events["connection.update"]) {
      ({ isLogout } = await handleConnectionUpdate(events["connection.update"]));
    }

    if (events["creds.update"] && !isLogout) {
      await handleCredsUpdate();
    }

    if (events["messaging-history.set"]) {
      await handleMessagingHistorySet(events["messaging-history.set"]);
    }

    if (events["contacts.upsert"]) {
      await handleContactsUpsert(events["contacts.upsert"]);
    }

    if (events["contacts.update"]) {
      await handleContactsUpdate(events["contacts.update"]);
    }

    if (events["messages.upsert"]) {
      await handleMessagesUpsert(events["messages.upsert"]);
    }

    if (events["messages.update"]) {
      await handleMessagesUpdate(events["messages.update"]);
    }

    if (events["chats.update"]) {
      await handleChatsUpdate(events["chats.update"]);
    }

    if (events["lid-mapping.update"]) {
      await handleLidMapping(events["lid-mapping.update"]);
    }
  };
}
