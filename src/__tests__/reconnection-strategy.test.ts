import { DisconnectReason } from "@whiskeysockets/baileys";
import { describe, expect, it } from "vitest";
import { defaultReconnectionStrategy } from "../reconnection-strategy.js";

describe("defaultReconnectionStrategy", () => {
  describe("decide", () => {
    it("returns 'logout' when statusCode === DisconnectReason.loggedOut", () => {
      const strategy = defaultReconnectionStrategy();
      expect(strategy.decide(DisconnectReason.loggedOut, undefined)).toBe("logout");
    });

    it("returns 'reconnect' for connectionClosed", () => {
      const strategy = defaultReconnectionStrategy();
      expect(strategy.decide(DisconnectReason.connectionClosed, undefined)).toBe("reconnect");
    });

    it("returns 'reconnect' for connectionLost / timedOut (408)", () => {
      const strategy = defaultReconnectionStrategy();
      expect(strategy.decide(DisconnectReason.connectionLost, undefined)).toBe("reconnect");
      expect(strategy.decide(DisconnectReason.timedOut, undefined)).toBe("reconnect");
    });

    it("returns 'reconnect' for connectionReplaced", () => {
      const strategy = defaultReconnectionStrategy();
      expect(strategy.decide(DisconnectReason.connectionReplaced, undefined)).toBe("reconnect");
    });

    it("returns 'reconnect' for badSession", () => {
      const strategy = defaultReconnectionStrategy();
      expect(strategy.decide(DisconnectReason.badSession, undefined)).toBe("reconnect");
    });

    it("returns 'reconnect' for restartRequired", () => {
      const strategy = defaultReconnectionStrategy();
      expect(strategy.decide(DisconnectReason.restartRequired, undefined)).toBe("reconnect");
    });

    it("returns 'reconnect' for multideviceMismatch", () => {
      const strategy = defaultReconnectionStrategy();
      expect(strategy.decide(DisconnectReason.multideviceMismatch, undefined)).toBe("reconnect");
    });

    it("returns 'reconnect' for forbidden", () => {
      const strategy = defaultReconnectionStrategy();
      expect(strategy.decide(DisconnectReason.forbidden, undefined)).toBe("reconnect");
    });

    it("returns 'reconnect' for unavailableService", () => {
      const strategy = defaultReconnectionStrategy();
      expect(strategy.decide(DisconnectReason.unavailableService, undefined)).toBe("reconnect");
    });

    it("returns 'reconnect' for undefined statusCode (unknown reason)", () => {
      const strategy = defaultReconnectionStrategy();
      expect(strategy.decide(undefined, undefined)).toBe("reconnect");
    });

    it("returns 'reconnect' for arbitrary non-logout numeric codes", () => {
      const strategy = defaultReconnectionStrategy();
      expect(strategy.decide(999, new Error("strange"))).toBe("reconnect");
    });
  });

  describe("getRetryOptions", () => {
    it("preserves the historical exponential backoff: 10 retries, 1s→60s, factor 2, randomized", () => {
      const strategy = defaultReconnectionStrategy();
      const opts = strategy.getRetryOptions();
      expect(opts.retries).toBe(10);
      expect(opts.minTimeout).toBe(1000);
      expect(opts.maxTimeout).toBe(60000);
      expect(opts.factor).toBe(2);
      expect(opts.randomize).toBe(true);
    });
  });
});
