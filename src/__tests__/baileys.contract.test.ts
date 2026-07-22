import {
  DisconnectReason,
  downloadMediaMessage,
  fetchLatestBaileysVersion,
  getUrlFromDirectPath,
  isJidGroup,
  jidNormalizedUser,
  makeCacheableSignalKeyStore,
  makeWASocket,
  normalizeMessageContent,
  toBuffer,
  useMultiFileAuthState,
} from "@whiskeysockets/baileys";
import pino from "pino";
import { afterEach, describe, expect, it, vi } from "vitest";

// Contract tests pinning the @whiskeysockets/baileys API surface consumed by
// this package. Must stay green across 7.0.0-rc.9 → rc13.
//
// A failure here means Baileys moved something we depend on — read the upstream
// changelog before "fixing" the test.
//
// Not covered here (deliberately): `socket.signalRepository.lidMapping`. That
// shape is pinned by `src/lid.ts`, which dereferences `.getPNForLID` /
// `.getLIDForPN` without a cast — so `pnpm build` (tsup dts) fails if it drifts.
// `src/__tests__` is excluded from tsconfig, so a type assertion placed here
// would not actually be checked.

const silentLogger = pino({ level: "silent" });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("baileys module surface", () => {
  it("exports every symbol this package imports", () => {
    expect(typeof makeWASocket).toBe("function");
    expect(typeof useMultiFileAuthState).toBe("function");
    expect(typeof makeCacheableSignalKeyStore).toBe("function");
    expect(typeof fetchLatestBaileysVersion).toBe("function");
    expect(typeof jidNormalizedUser).toBe("function");
    expect(typeof isJidGroup).toBe("function");
    expect(typeof normalizeMessageContent).toBe("function");
    expect(typeof downloadMediaMessage).toBe("function");
    expect(typeof getUrlFromDirectPath).toBe("function");
    expect(typeof toBuffer).toBe("function");
  });

  it("DisconnectReason exposes the codes the reconnection path branches on", () => {
    // connection.ts / connection-handler.ts / reconnection-strategy.ts each
    // branch on these. `loggedOut` in particular gates the auth_info purge.
    expect(typeof DisconnectReason.loggedOut).toBe("number");
    expect(typeof DisconnectReason.restartRequired).toBe("number");
    expect(typeof DisconnectReason.connectionClosed).toBe("number");
    expect(typeof DisconnectReason.connectionLost).toBe("number");
    expect(typeof DisconnectReason.connectionReplaced).toBe("number");
    expect(typeof DisconnectReason.timedOut).toBe("number");
    expect(typeof DisconnectReason.badSession).toBe("number");
  });
});

describe("fetchLatestBaileysVersion contract", () => {
  // connection.ts:44 destructures `{ version, isLatest }` and passes `version`
  // straight into makeWASocket. Prod depends on this returning the live WA
  // version rather than the (stale) bundled constant.

  it("returns {version, isLatest} parsed from the upstream Defaults source", async () => {
    // Upstream scrapes line 7 (0-indexed 6) of Defaults/index.ts for
    // `const version = [a, b, c]`. Brittle by construction — pin it.
    const defaultsSource = [
      "import { proto } from '../../WAProto/index.js'",
      "import { makeLibSignalRepository } from '../Signal/libsignal'",
      "import type { AuthenticationState, SocketConfig, WAVersion } from '../Types'",
      "import { Browsers } from '../Utils/browser-utils'",
      "import logger from '../Utils/logger'",
      "",
      "const version = [2, 3000, 1035194821]",
    ].join("\n");

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, text: async () => defaultsSource }),
    );

    const { version, isLatest } = await fetchLatestBaileysVersion();

    expect(version).toEqual([2, 3000, 1035194821]);
    expect(isLatest).toBe(true);
  });

  it("falls back to the bundled version instead of throwing when the fetch fails", async () => {
    // This is what keeps a boot from failing when GitHub is unreachable.
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    const { version, isLatest } = await fetchLatestBaileysVersion();

    expect(Array.isArray(version)).toBe(true);
    expect(version).toHaveLength(3);
    expect(version.every((part) => typeof part === "number")).toBe(true);
    expect(isLatest).toBe(false);
  });
});

describe("JID helper contract", () => {
  it("jidNormalizedUser strips the device/agent suffix", () => {
    // sender.ts normalizes every recipient before sendMessage.
    expect(jidNormalizedUser("5531991234567:12@s.whatsapp.net")).toBe(
      "5531991234567@s.whatsapp.net",
    );
    expect(jidNormalizedUser("5531991234567@s.whatsapp.net")).toBe("5531991234567@s.whatsapp.net");
  });

  it("isJidGroup distinguishes @g.us from user and LID JIDs", () => {
    // utils.ts wraps this as isGroupJid; parseMessage uses it to decide whether
    // `key.participant` or `key.remoteJid` is the sender.
    expect(isJidGroup("120363001234567890@g.us")).toBe(true);
    expect(isJidGroup("5531991234567@s.whatsapp.net")).toBeFalsy();
    expect(isJidGroup("11122233344455@lid")).toBeFalsy();
  });
});

describe("message + media helper contract", () => {
  it("normalizeMessageContent unwraps ephemeral and viewOnce wrappers", () => {
    // utils.ts:parseMessage relies on this to reach the inner content before
    // extractMessageContent runs.
    const plain = { conversation: "olá" };
    expect(normalizeMessageContent(plain)).toEqual(plain);

    const ephemeral = { ephemeralMessage: { message: { conversation: "olá" } } };
    expect(normalizeMessageContent(ephemeral as never)).toEqual(plain);

    const viewOnce = { viewOnceMessage: { message: { conversation: "olá" } } };
    expect(normalizeMessageContent(viewOnce as never)).toEqual(plain);
  });

  it("getUrlFromDirectPath builds an absolute CDN URL", () => {
    // media.ts falls back to this when a stored media_url is missing/expired.
    const url = getUrlFromDirectPath("/v/t62.7118-24/some-object.enc?ccb=11-4");
    expect(url).toContain("/v/t62.7118-24/some-object.enc");
    expect(url.startsWith("https://")).toBe(true);
  });

  it("toBuffer concatenates a readable stream into a Buffer", async () => {
    // media.ts uses this when downloadMediaMessage yields a stream, not a Buffer.
    const { Readable } = await import("node:stream");
    const stream = Readable.from([Buffer.from("abc"), Buffer.from("def")]);
    const buf = await toBuffer(stream);
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.toString()).toBe("abcdef");
  });
});

describe("makeCacheableSignalKeyStore contract", () => {
  it("accepts (keys, logger) and returns a store with get/set", () => {
    // connection.ts:49 calls this with exactly two positional args.
    const inner = { get: vi.fn().mockResolvedValue({}), set: vi.fn().mockResolvedValue(undefined) };
    const store = makeCacheableSignalKeyStore(inner as never, silentLogger);

    expect(typeof store.get).toBe("function");
    expect(typeof store.set).toBe("function");
  });
});
