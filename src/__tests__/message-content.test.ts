import type { WAMessage } from "@whiskeysockets/baileys";
import { describe, expect, it } from "vitest";
import { extractMessageContent } from "../message-content.js";

type MsgContent = NonNullable<WAMessage["message"]>;

describe("extractMessageContent", () => {
  it("returns null for null content", () => {
    expect(extractMessageContent(null)).toBeNull();
  });

  it("returns null for undefined content", () => {
    expect(extractMessageContent(undefined)).toBeNull();
  });

  it("returns null for empty object", () => {
    expect(extractMessageContent({} as MsgContent)).toBeNull();
  });

  it("extracts conversation text", () => {
    expect(extractMessageContent({ conversation: "Hello world" } as MsgContent)).toBe(
      "Hello world",
    );
  });

  it("extracts extendedTextMessage text", () => {
    expect(
      extractMessageContent({
        extendedTextMessage: { text: "Extended text" },
      } as MsgContent),
    ).toBe("Extended text");
  });

  it("extracts image with caption", () => {
    expect(
      extractMessageContent({
        imageMessage: { caption: "look", mimetype: "image/jpeg" },
      } as MsgContent),
    ).toBe("[Image] look");
  });

  it("falls back to [Image] when image has no caption", () => {
    expect(
      extractMessageContent({
        imageMessage: { mimetype: "image/jpeg" },
      } as MsgContent),
    ).toBe("[Image]");
  });

  it("extracts video with caption", () => {
    expect(
      extractMessageContent({
        videoMessage: { caption: "clip", mimetype: "video/mp4" },
      } as MsgContent),
    ).toBe("[Video] clip");
  });

  it("falls back to [Video] when video has no caption", () => {
    expect(
      extractMessageContent({
        videoMessage: { mimetype: "video/mp4" },
      } as MsgContent),
    ).toBe("[Video]");
  });

  it("extracts document with caption (caption preferred over fileName)", () => {
    expect(
      extractMessageContent({
        documentMessage: {
          caption: "important",
          fileName: "report.pdf",
          mimetype: "application/pdf",
        },
      } as MsgContent),
    ).toBe("[Document] important");
  });

  it("extracts document with only fileName", () => {
    expect(
      extractMessageContent({
        documentMessage: {
          fileName: "report.pdf",
          mimetype: "application/pdf",
        },
      } as MsgContent),
    ).toBe("[Document] report.pdf");
  });

  it("falls back to [Document] when document has no caption or fileName", () => {
    expect(
      extractMessageContent({
        documentMessage: { mimetype: "application/pdf" },
      } as MsgContent),
    ).toBe("[Document]");
  });

  it("extracts audio as [Audio]", () => {
    expect(
      extractMessageContent({
        audioMessage: { mimetype: "audio/ogg; codecs=opus" },
      } as MsgContent),
    ).toBe("[Audio]");
  });

  it("extracts ptt audio as [Audio] (same label)", () => {
    expect(
      extractMessageContent({
        audioMessage: { mimetype: "audio/ogg; codecs=opus", ptt: true },
      } as MsgContent),
    ).toBe("[Audio]");
  });

  it("extracts sticker as [Sticker]", () => {
    expect(
      extractMessageContent({
        stickerMessage: { mimetype: "image/webp" },
      } as MsgContent),
    ).toBe("[Sticker]");
  });

  it("extracts location with address", () => {
    expect(
      extractMessageContent({
        locationMessage: { address: "Av. Paulista, 1000" },
      } as MsgContent),
    ).toBe("[Location] Av. Paulista, 1000");
  });

  it("returns null for location without address", () => {
    expect(
      extractMessageContent({
        locationMessage: { degreesLatitude: -23.5, degreesLongitude: -46.6 },
      } as MsgContent),
    ).toBeNull();
  });

  it("extracts contact with displayName", () => {
    expect(
      extractMessageContent({
        contactMessage: { displayName: "Alice" },
      } as MsgContent),
    ).toBe("[Contact] Alice");
  });

  it("returns null for contact without displayName", () => {
    expect(
      extractMessageContent({
        contactMessage: { vcard: "BEGIN:VCARD\nEND:VCARD" },
      } as MsgContent),
    ).toBeNull();
  });

  it("extracts poll with name", () => {
    expect(
      extractMessageContent({
        pollCreationMessage: { name: "Lunch?" },
      } as MsgContent),
    ).toBe("[Poll] Lunch?");
  });

  it("returns null for poll without name", () => {
    expect(
      extractMessageContent({
        pollCreationMessage: { options: [{ optionName: "yes" }] },
      } as MsgContent),
    ).toBeNull();
  });

  it("returns null for unknown message type", () => {
    expect(
      extractMessageContent({
        someUnknownMessage: { foo: "bar" },
      } as unknown as MsgContent),
    ).toBeNull();
  });

  it("prefers conversation over imageMessage when both present", () => {
    expect(
      extractMessageContent({
        conversation: "text wins",
        imageMessage: { caption: "ignored", mimetype: "image/jpeg" },
      } as MsgContent),
    ).toBe("text wins");
  });
});
