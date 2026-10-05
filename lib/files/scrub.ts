import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFRef, PDFString } from "pdf-lib";
import type { DocumentKind } from "@/lib/files/validate";

/**
 * Removes the reviewer's identity from the bytes of an annotated file.
 *
 * This is the second anonymity layer. Hiding a reviewer's name in the
 * interface is worthless if the file the author downloads still says who
 * marked it up — and it does, in more places than the obvious one:
 *
 *   Word (.docx, a zip of XML parts)
 *     - docProps/core.xml: creator and last-modified-by
 *     - docProps/app.xml: company and manager
 *     - every tracked insertion, deletion and formatting change, and every
 *       comment, carries a w:author attribute (and comments a w:initials)
 *     - word/people.xml lists each commenter, often with their sign-in email
 *
 *   PDF
 *     - the Info dictionary: Author, Creator, Producer
 *     - the XMP metadata stream, which repeats them
 *     - every annotation (sticky note, highlight) has a /T entry naming who
 *       made it
 *
 * Pure: bytes in, bytes out. It does not touch storage or the database.
 *
 * What it cannot do: remove a name the reviewer typed into the text of a
 * comment or the document itself. That is content, not metadata.
 */

export const ANONYMOUS_AUTHOR = "Reviewer";
const ANONYMOUS_INITIALS = "R";

/** File types a reviewer may return: the ones that can be reliably scrubbed. */
export const SCRUBBABLE_KINDS = ["pdf", "docx", "txt"] as const satisfies readonly DocumentKind[];
export type ScrubbableKind = (typeof SCRUBBABLE_KINDS)[number];

export function isScrubbable(kind: DocumentKind): kind is ScrubbableKind {
  return (SCRUBBABLE_KINDS as readonly string[]).includes(kind);
}

export type ScrubFailure = "unreadable" | "encrypted" | "too_large_unpacked";

export type ScrubResult =
  | {
      ok: true;
      bytes: Uint8Array;
      /** The distinct names and identifiers that were found and removed. */
      removed: string[];
    }
  | { ok: false; reason: ScrubFailure };

/** A .docx is a zip; refuse one that unpacks to something absurd. */
const MAX_UNPACKED_BYTES = 250 * 1024 * 1024;

// ── Word ───────────────────────────────────────────────────────────────────

function unescapeXml(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/** Replaces the value of every `prefix:name="…"` attribute, in either quote style. */
function replaceAttribute(
  xml: string,
  localName: string,
  replacement: string,
  removed: Set<string>,
): string {
  const pattern = new RegExp(`(\\b[A-Za-z][\\w.-]*:${localName}\\s*=\\s*)(["'])(.*?)\\2`, "g");
  return xml.replace(pattern, (_match, prefix: string, quote: string, value: string) => {
    if (value && value !== replacement) removed.add(unescapeXml(value));
    return `${prefix}${quote}${replacement}${quote}`;
  });
}

/** Replaces the text content of every `<tag>…</tag>` element. */
function replaceElementText(
  xml: string,
  tag: string,
  replacement: string,
  removed: Set<string>,
): string {
  const pattern = new RegExp(`(<${tag}\\b[^>]*>)([\\s\\S]*?)(</${tag}>)`, "g");
  return xml.replace(pattern, (_match, open: string, value: string, close: string) => {
    const text = value.trim();
    if (text && text !== replacement) removed.add(unescapeXml(text));
    return `${open}${replacement}${close}`;
  });
}

function scrubWordPart(path: string, xml: string, removed: Set<string>): string {
  if (path === "docProps/core.xml") {
    let out = replaceElementText(xml, "dc:creator", ANONYMOUS_AUTHOR, removed);
    out = replaceElementText(out, "cp:lastModifiedBy", ANONYMOUS_AUTHOR, removed);
    return out;
  }

  if (path === "docProps/app.xml") {
    let out = replaceElementText(xml, "Company", "", removed);
    out = replaceElementText(out, "Manager", "", removed);
    return out;
  }

  if (path === "docProps/custom.xml") {
    // Custom properties are free-form and often set by an organisation's
    // templates (department, owner, employee id). Blank the values.
    return replaceElementText(xml, "vt:lpwstr", "", removed);
  }

  if (path.startsWith("word/")) {
    // Tracked changes, comments, and anything else that names an author:
    // w:author, w15:author, w16…:author all match.
    let out = replaceAttribute(xml, "author", ANONYMOUS_AUTHOR, removed);
    out = replaceAttribute(out, "initials", ANONYMOUS_INITIALS, removed);
    // people.xml ties each commenter to a directory identity, e.g.
    // w15:userId="S::rita@example.org::<guid>". Drop the element outright.
    out = out.replace(
      /<w15:presenceInfo\b[^>]*?(?:\/>|>[\s\S]*?<\/w15:presenceInfo>)/g,
      (match) => {
        const userId = /w15:userId\s*=\s*(["'])(.*?)\1/.exec(match)?.[2];
        if (userId) removed.add(unescapeXml(userId));
        return "";
      },
    );
    return out;
  }

  return xml;
}

function scrubDocx(bytes: Uint8Array): ScrubResult {
  let unpacked = 0;
  let tooLarge = false;
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes, {
      filter: (file) => {
        unpacked += file.originalSize;
        if (unpacked > MAX_UNPACKED_BYTES) tooLarge = true;
        return !tooLarge;
      },
    });
  } catch {
    return { ok: false, reason: "unreadable" };
  }
  if (tooLarge) return { ok: false, reason: "too_large_unpacked" };
  // Without this part it is some other zip wearing a .docx name.
  if (!entries["word/document.xml"]) return { ok: false, reason: "unreadable" };

  const removed = new Set<string>();
  const output: Record<string, Uint8Array> = {};

  for (const [path, content] of Object.entries(entries)) {
    const isXml = path.endsWith(".xml") || path.endsWith(".rels");
    output[path] = isXml ? strToU8(scrubWordPart(path, strFromU8(content), removed)) : content;
  }

  return { ok: true, bytes: zipSync(output), removed: [...removed] };
}

// ── PDF ────────────────────────────────────────────────────────────────────

const INFO_KEYS = ["Author", "Creator", "Producer"];

function textOf(value: unknown): string | null {
  return value instanceof PDFString || value instanceof PDFHexString ? value.decodeText() : null;
}

async function scrubPdfStrict(bytes: Uint8Array): Promise<ScrubResult> {
  let document: PDFDocument;
  try {
    // updateMetadata: false stops pdf-lib stamping itself in as the producer.
    document = await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (error) {
    const encrypted = /encrypt/i.test(error instanceof Error ? error.message : "");
    return { ok: false, reason: encrypted ? "encrypted" : "unreadable" };
  }

  const removed = new Set<string>();
  const { context } = document;

  // 1. The Info dictionary.
  const infoRef = context.trailerInfo.Info;
  const info = infoRef ? context.lookupMaybe(infoRef, PDFDict) : undefined;
  if (info) {
    for (const key of INFO_KEYS) {
      const name = PDFName.of(key);
      const text = textOf(info.get(name));
      if (text) removed.add(text);
      info.delete(name);
    }
  }

  // 2. The XMP metadata stream. Unlinking it from the catalog is not enough:
  //    the writer emits every object it holds, referenced or not, so the
  //    stream itself has to be deleted or its bytes would still be in the file.
  const metadataKey = PDFName.of("Metadata");
  const metadata = document.catalog.get(metadataKey);
  if (metadata instanceof PDFRef) context.delete(metadata);
  document.catalog.delete(metadataKey);

  // 3. Annotations: each one names its author in /T.
  const titleKey = PDFName.of("T");
  for (const page of document.getPages()) {
    const annotations = page.node.Annots();
    if (!(annotations instanceof PDFArray)) continue;
    for (let i = 0; i < annotations.size(); i++) {
      const annotation = annotations.lookupMaybe(i, PDFDict);
      if (!annotation?.has(titleKey)) continue;
      const text = textOf(annotation.lookup(titleKey));
      if (text && text !== ANONYMOUS_AUTHOR) removed.add(text);
      annotation.set(titleKey, PDFHexString.fromText(ANONYMOUS_AUTHOR));
    }
  }

  // A full rewrite, not an incremental update, so no earlier revision of the
  // file — with the old metadata — survives inside it.
  const output = await document.save({ useObjectStreams: false });
  return { ok: true, bytes: output, removed: [...removed] };
}

/**
 * pdf-lib is forgiving: it will "load" bytes that are barely a PDF and then
 * fail somewhere inside. Any such failure means the file could not be
 * scrubbed with confidence, so it is refused.
 */
async function scrubPdf(bytes: Uint8Array): Promise<ScrubResult> {
  try {
    return await scrubPdfStrict(bytes);
  } catch {
    return { ok: false, reason: "unreadable" };
  }
}

// ── Entry point ────────────────────────────────────────────────────────────

/**
 * Scrubs a reviewer's file. Plain text has no metadata and passes through.
 * Fails closed: a file that cannot be parsed is rejected, never passed on
 * unscrubbed.
 */
export async function scrubDocument(kind: ScrubbableKind, bytes: Uint8Array): Promise<ScrubResult> {
  if (kind === "docx") return scrubDocx(bytes);
  if (kind === "pdf") return scrubPdf(bytes);
  return { ok: true, bytes, removed: [] };
}

/**
 * The name an author sees on the annotated file. Built from the reference,
 * so whatever the reviewer called their copy — "Rita's notes FINAL.docx" —
 * never reaches the author.
 */
export function reviewedFilename(reference: string, kind: ScrubbableKind): string {
  return `${reference}-reviewed.${kind}`;
}
