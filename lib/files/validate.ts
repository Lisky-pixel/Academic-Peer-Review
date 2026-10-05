/**
 * Upload validation for documents.
 *
 * A file is accepted only if four things agree: its extension, the MIME type
 * the browser declared, its size, and — the one that cannot be faked by
 * renaming — the bytes it actually starts with. The first three are checked
 * before an upload URL is issued; the bytes are checked after the upload,
 * when the server can read them.
 *
 * Pure: no storage, no environment. The size limit is passed in.
 */

export type DocumentKind = "pdf" | "docx" | "doc" | "txt" | "rtf";

type KindRule = {
  extension: string;
  /** What browsers report for this type. Some report nothing for .rtf/.txt. */
  mimeTypes: string[];
  /** The MIME type recorded and served, whatever the browser claimed. */
  canonicalMime: string;
  matches: (bytes: Uint8Array) => boolean;
};

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  return signature.every((byte, i) => bytes[i] === byte);
}

/** Plain text has no signature; the best available test is "no binary". */
function looksLikeText(bytes: Uint8Array): boolean {
  const sample = bytes.subarray(0, 8192);
  return sample.length > 0 && !sample.includes(0);
}

const RULES: Record<DocumentKind, KindRule> = {
  pdf: {
    extension: "pdf",
    mimeTypes: ["application/pdf"],
    canonicalMime: "application/pdf",
    matches: (bytes) => startsWith(bytes, [0x25, 0x50, 0x44, 0x46]), // %PDF
  },
  docx: {
    extension: "docx",
    mimeTypes: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
    canonicalMime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    matches: (bytes) => startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]), // zip
  },
  doc: {
    extension: "doc",
    mimeTypes: ["application/msword"],
    canonicalMime: "application/msword",
    matches: (bytes) => startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
  },
  rtf: {
    extension: "rtf",
    mimeTypes: ["application/rtf", "text/rtf", ""],
    canonicalMime: "application/rtf",
    matches: (bytes) => startsWith(bytes, [0x7b, 0x5c, 0x72, 0x74, 0x66]), // {\rtf
  },
  txt: {
    extension: "txt",
    mimeTypes: ["text/plain", ""],
    canonicalMime: "text/plain",
    matches: looksLikeText,
  },
};

export const ACCEPTED_EXTENSIONS = Object.values(RULES).map((rule) => `.${rule.extension}`);

/** For the `accept` attribute of a file input. */
export const ACCEPT_ATTRIBUTE = [
  ...ACCEPTED_EXTENSIONS,
  ...Object.values(RULES).flatMap((rule) => rule.mimeTypes.filter(Boolean)),
].join(",");

export type FileRejection = "unsupported_type" | "too_large" | "empty" | "content_mismatch";

export const REJECTION_MESSAGE: Record<FileRejection, string> = {
  unsupported_type: "That file type is not supported. Upload a PDF, DOCX, DOC, RTF or TXT file.",
  too_large: "That file is too large.",
  empty: "That file is empty.",
  content_mismatch:
    "That file is not what its name says it is. Save it again from your word processor and retry.",
};

export function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot < 0 ? "" : filename.slice(dot + 1).toLowerCase();
}

export type DeclaredFileCheck =
  { ok: true; kind: DocumentKind; mimeType: string } | { ok: false; reason: FileRejection };

/**
 * Checks what the browser says about a file, before any bytes are uploaded.
 * The extension decides the kind; the declared MIME type must be one that
 * kind is known to arrive as.
 */
export function checkDeclaredFile(
  file: { filename: string; mimeType: string; sizeBytes: number },
  maxBytes: number,
): DeclaredFileCheck {
  const extension = extensionOf(file.filename);
  const entry = (Object.entries(RULES) as Array<[DocumentKind, KindRule]>).find(
    ([, rule]) => rule.extension === extension,
  );
  if (!entry) return { ok: false, reason: "unsupported_type" };

  const [kind, rule] = entry;
  if (!rule.mimeTypes.includes(file.mimeType)) return { ok: false, reason: "unsupported_type" };
  if (!Number.isInteger(file.sizeBytes) || file.sizeBytes <= 0) {
    return { ok: false, reason: "empty" };
  }
  if (file.sizeBytes > maxBytes) return { ok: false, reason: "too_large" };

  return { ok: true, kind, mimeType: rule.canonicalMime };
}

/** Checks the uploaded bytes really are the kind the file claimed to be. */
export function checkFileContent(
  kind: DocumentKind,
  bytes: Uint8Array,
  maxBytes: number,
): { ok: true } | { ok: false; reason: FileRejection } {
  if (bytes.length === 0) return { ok: false, reason: "empty" };
  if (bytes.length > maxBytes) return { ok: false, reason: "too_large" };
  if (!RULES[kind].matches(bytes)) return { ok: false, reason: "content_mismatch" };
  return { ok: true };
}

/** "2.4 MB" — for showing a size to a person. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
