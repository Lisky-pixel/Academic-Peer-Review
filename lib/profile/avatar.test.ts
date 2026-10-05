import { describe, expect, it } from "vitest";
import { AVATAR_MAX_BYTES, checkAvatar, sniffAvatarMime } from "@/lib/profile/avatar";

const bytes = (...values: number[]) => new Uint8Array(values);
const ascii = (text: string) => Array.from(text, (char) => char.charCodeAt(0));

const JPEG = bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0x10);
const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0);
const WEBP = bytes(...ascii("RIFF"), 1, 2, 3, 4, ...ascii("WEBP"), ...ascii("VP8 "));

describe("sniffAvatarMime", () => {
  it.each([
    ["image/jpeg", JPEG],
    ["image/png", PNG],
    ["image/webp", WEBP],
  ])("recognises %s from its leading bytes", (mime, file) => {
    expect(sniffAvatarMime(file)).toBe(mime);
  });

  it.each([
    ["an SVG, which can carry script", ascii('<svg xmlns="http://www.w3.org/2000/svg">')],
    ["an HTML page", ascii("<!doctype html><script>alert(1)</script>")],
    ["a GIF", ascii("GIF89a")],
    ["a RIFF file that is not WebP", [...ascii("RIFF"), 1, 2, 3, 4, ...ascii("WAVE")]],
    ["a PDF", ascii("%PDF-1.7")],
    ["a truncated PNG signature", [0x89, 0x50, 0x4e]],
    ["nothing at all", []],
  ])("refuses %s", (_label, content) => {
    expect(sniffAvatarMime(bytes(...content))).toBeNull();
  });
});

describe("checkAvatar", () => {
  it("accepts a real image and reports its type", () => {
    expect(checkAvatar(PNG)).toEqual({ ok: true, mime: "image/png" });
  });

  it("refuses an empty upload", () => {
    expect(checkAvatar(bytes())).toEqual({ ok: false, reason: "empty" });
  });

  it("refuses anything over the size limit, even a genuine image", () => {
    const large = new Uint8Array(AVATAR_MAX_BYTES + 1);
    large.set(PNG);

    expect(checkAvatar(large)).toEqual({ ok: false, reason: "too_large" });
  });

  it("accepts an image exactly at the limit", () => {
    const atLimit = new Uint8Array(AVATAR_MAX_BYTES);
    atLimit.set(JPEG);

    expect(checkAvatar(atLimit)).toMatchObject({ ok: true });
  });

  it("refuses a file that only claims to be an image", () => {
    expect(checkAvatar(bytes(...ascii("<script>alert(1)</script>")))).toEqual({
      ok: false,
      reason: "not_an_image",
    });
  });
});
