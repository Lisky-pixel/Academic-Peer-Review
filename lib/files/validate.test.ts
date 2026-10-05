import { describe, expect, it } from "vitest";
import {
  checkDeclaredFile,
  checkFileContent,
  type DocumentKind,
  extensionOf,
  formatBytes,
} from "@/lib/files/validate";

const MAX = 20 * 1024 * 1024;
const ascii = (text: string) => new Uint8Array(Array.from(text, (c) => c.charCodeAt(0)));
const bytes = (...values: number[]) => new Uint8Array(values);

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const SAMPLES: Record<DocumentKind, Uint8Array> = {
  pdf: ascii("%PDF-1.7\n..."),
  docx: bytes(0x50, 0x4b, 0x03, 0x04, 0x14, 0x00),
  doc: bytes(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0x00),
  rtf: ascii("{\\rtf1\\ansi Hello}"),
  txt: ascii("Dear admissions committee,\n"),
};

describe("extensionOf", () => {
  it.each([
    ["essay.PDF", "pdf"],
    ["my.final.v2.docx", "docx"],
    ["no-extension", ""],
    ["trailing.", ""],
  ])("%s → %j", (filename, expected) => {
    expect(extensionOf(filename)).toBe(expected);
  });
});

describe("checkDeclaredFile", () => {
  it.each([
    ["statement.pdf", "application/pdf", "pdf"],
    ["statement.docx", DOCX_MIME, "docx"],
    ["statement.doc", "application/msword", "doc"],
    ["statement.rtf", "application/rtf", "rtf"],
    ["statement.rtf", "text/rtf", "rtf"],
    ["statement.txt", "text/plain", "txt"],
    // Some browsers report no type at all for these two.
    ["statement.txt", "", "txt"],
    ["statement.rtf", "", "rtf"],
  ])("accepts %s declared as %j", (filename, mimeType, kind) => {
    expect(checkDeclaredFile({ filename, mimeType, sizeBytes: 1000 }, MAX)).toMatchObject({
      ok: true,
      kind,
    });
  });

  it("records the canonical type, not whatever the browser claimed", () => {
    const result = checkDeclaredFile(
      { filename: "a.rtf", mimeType: "text/rtf", sizeBytes: 10 },
      MAX,
    );
    expect(result).toMatchObject({ ok: true, mimeType: "application/rtf" });
  });

  it.each([
    ["an executable", "setup.exe", "application/x-msdownload"],
    ["a web page", "page.html", "text/html"],
    ["an image", "scan.png", "image/png"],
    ["a file with no extension", "statement", "application/pdf"],
    ["a PDF name with a mismatched type", "statement.pdf", "text/html"],
    ["a DOCX name declared as a PDF", "statement.docx", "application/pdf"],
    ["a double extension hiding a script", "statement.pdf.js", "application/pdf"],
    // No signature can vouch for a PDF, so an empty type is not good enough.
    ["a PDF with no declared type", "statement.pdf", ""],
  ])("refuses %s", (_label, filename, mimeType) => {
    expect(checkDeclaredFile({ filename, mimeType, sizeBytes: 1000 }, MAX)).toEqual({
      ok: false,
      reason: "unsupported_type",
    });
  });

  it("refuses a file over the limit and accepts one exactly at it", () => {
    const file = { filename: "a.pdf", mimeType: "application/pdf" };
    expect(checkDeclaredFile({ ...file, sizeBytes: MAX + 1 }, MAX)).toEqual({
      ok: false,
      reason: "too_large",
    });
    expect(checkDeclaredFile({ ...file, sizeBytes: MAX }, MAX)).toMatchObject({ ok: true });
  });

  it.each([0, -1, 1.5, Number.NaN])("refuses a size of %s", (sizeBytes) => {
    expect(
      checkDeclaredFile({ filename: "a.pdf", mimeType: "application/pdf", sizeBytes }, MAX),
    ).toEqual({ ok: false, reason: "empty" });
  });
});

describe("checkFileContent", () => {
  it.each(Object.keys(SAMPLES) as DocumentKind[])("accepts genuine %s bytes", (kind) => {
    expect(checkFileContent(kind, SAMPLES[kind], MAX)).toEqual({ ok: true });
  });

  it.each([
    ["an HTML page renamed .pdf", "pdf", ascii("<!doctype html><script>alert(1)</script>")],
    ["a PDF renamed .docx", "docx", SAMPLES.pdf],
    ["a zip renamed .doc", "doc", SAMPLES.docx],
    ["plain text renamed .rtf", "rtf", SAMPLES.txt],
    ["a binary renamed .txt", "txt", bytes(0x4d, 0x5a, 0x00, 0x03, 0x00)],
  ] as Array<[string, DocumentKind, Uint8Array]>)("refuses %s", (_label, kind, content) => {
    expect(checkFileContent(kind, content, MAX)).toEqual({
      ok: false,
      reason: "content_mismatch",
    });
  });

  it("refuses empty content and content over the limit", () => {
    expect(checkFileContent("pdf", bytes(), MAX)).toEqual({ ok: false, reason: "empty" });
    expect(checkFileContent("txt", new Uint8Array(11).fill(65), 10)).toEqual({
      ok: false,
      reason: "too_large",
    });
  });
});

describe("formatBytes", () => {
  it.each([
    [512, "512 B"],
    [2048, "2 KB"],
    [2.4 * 1024 * 1024, "2.4 MB"],
    [20 * 1024 * 1024, "20.0 MB"],
  ])("%d → %s", (input, expected) => {
    expect(formatBytes(input)).toBe(expected);
  });
});
