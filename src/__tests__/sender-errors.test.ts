import { describe, expect, it } from "vitest";
import { classifySenderError } from "../sender-errors.js";

describe("classifySenderError", () => {
  describe("permanent errors (message-based)", () => {
    const permanentMessages = [
      "not-authorized",
      "Not-Authorized",
      "bad-request",
      "forbidden",
      "recipient-not-found",
      "payload-too-large",
    ];

    for (const message of permanentMessages) {
      it(`classifies "${message}" as permanent`, () => {
        expect(classifySenderError(new Error(message))).toBe("permanent");
      });
    }

    it("classifies messages containing permanent tokens (substring match)", () => {
      expect(classifySenderError(new Error("Server returned bad-request status"))).toBe(
        "permanent",
      );
    });
  });

  describe("transient errors (message-based)", () => {
    const transientMessages = [
      "timeout",
      "ECONNRESET",
      "econnrefused",
      "ENOTFOUND",
      "network-error",
      // The real Boom messages thrown by Baileys for codes 428 and 440 — not
      // hyphenated. These tests pin the runtime-observed strings.
      "Connection Closed",
      "Stream Errored (conflict)",
    ];

    for (const message of transientMessages) {
      it(`classifies "${message}" as transient`, () => {
        expect(classifySenderError(new Error(message))).toBe("transient");
      });
    }
  });

  describe("Boom-style errors with statusCode", () => {
    it("classifies 401 as permanent", () => {
      const err = Object.assign(new Error("Auth failed"), {
        output: { statusCode: 401 },
      });
      expect(classifySenderError(err)).toBe("permanent");
    });

    it("classifies 403 as permanent", () => {
      const err = Object.assign(new Error("forbidden"), {
        output: { statusCode: 403 },
      });
      expect(classifySenderError(err)).toBe("permanent");
    });

    it("classifies 400 as permanent", () => {
      const err = Object.assign(new Error("bad"), {
        output: { statusCode: 400 },
      });
      expect(classifySenderError(err)).toBe("permanent");
    });

    it("classifies 404 as permanent", () => {
      const err = Object.assign(new Error("not found"), {
        output: { statusCode: 404 },
      });
      expect(classifySenderError(err)).toBe("permanent");
    });

    it("classifies 413 as permanent", () => {
      const err = Object.assign(new Error("too big"), {
        output: { statusCode: 413 },
      });
      expect(classifySenderError(err)).toBe("permanent");
    });

    it("classifies 408 (request timeout) as transient", () => {
      const err = Object.assign(new Error("request timeout"), {
        output: { statusCode: 408 },
      });
      expect(classifySenderError(err)).toBe("transient");
    });

    it("classifies 428 (Baileys Connection Closed) as transient", () => {
      const err = Object.assign(new Error("Connection Closed"), {
        output: { statusCode: 428 },
      });
      expect(classifySenderError(err)).toBe("transient");
    });

    it("classifies 440 (Baileys Stream Errored) as transient", () => {
      const err = Object.assign(new Error("Stream Errored (conflict)"), {
        output: { statusCode: 440 },
      });
      expect(classifySenderError(err)).toBe("transient");
    });

    it("classifies 503 as transient", () => {
      const err = Object.assign(new Error("service unavailable"), {
        output: { statusCode: 503 },
      });
      expect(classifySenderError(err)).toBe("transient");
    });

    it("returns unknown for an unrecognised statusCode and unrecognised message", () => {
      const err = Object.assign(new Error("weird"), {
        output: { statusCode: 418 },
      });
      expect(classifySenderError(err)).toBe("unknown");
    });
  });

  describe("unknown errors", () => {
    it("classifies plain Error with unrecognised message as unknown", () => {
      expect(classifySenderError(new Error("something weird happened"))).toBe("unknown");
    });

    it("classifies non-Error values as unknown", () => {
      expect(classifySenderError("string error")).toBe("unknown");
      expect(classifySenderError(null)).toBe("unknown");
      expect(classifySenderError(undefined)).toBe("unknown");
      expect(classifySenderError(42)).toBe("unknown");
      expect(classifySenderError({})).toBe("unknown");
    });
  });
});
