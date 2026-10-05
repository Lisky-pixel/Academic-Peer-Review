/**
 * Profile picture validation.
 *
 * The browser crops and resizes a picture to AVATAR_SIZE before uploading, so
 * a genuine upload is a few tens of kilobytes. Nothing here trusts that: the
 * type is decided from the file's own leading bytes, never from the name or
 * the Content-Type the client claimed, and anything else is refused.
 *
 * Pure — no database, no environment — so it is trivially testable.
 */

/** Pixels per side the browser resizes to. */
export const AVATAR_SIZE = 256;

/** Generous for a 256px image, small enough that the column stays cheap. */
export const AVATAR_MAX_BYTES = 300 * 1024;

export type AvatarMime = "image/jpeg" | "image/png" | "image/webp";

function startsWith(bytes: Uint8Array, signature: number[], offset = 0): boolean {
  return signature.every((byte, i) => bytes[offset + i] === byte);
}

/**
 * Identifies an image by its magic bytes, or returns null.
 *
 * SVG is deliberately not accepted: it is a document that can carry script,
 * not a picture.
 */
export function sniffAvatarMime(bytes: Uint8Array): AvatarMime | null {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  // "RIFF" <4 size bytes> "WEBP"
  if (
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)
  ) {
    return "image/webp";
  }
  return null;
}

export type AvatarCheck =
  { ok: true; mime: AvatarMime } | { ok: false; reason: "empty" | "too_large" | "not_an_image" };

export function checkAvatar(bytes: Uint8Array): AvatarCheck {
  if (bytes.length === 0) return { ok: false, reason: "empty" };
  if (bytes.length > AVATAR_MAX_BYTES) return { ok: false, reason: "too_large" };
  const mime = sniffAvatarMime(bytes);
  return mime ? { ok: true, mime } : { ok: false, reason: "not_an_image" };
}
