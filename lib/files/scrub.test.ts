// @vitest-environment node
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { PDFDict, PDFDocument, PDFHexString, PDFName, PDFString } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { ANONYMOUS_AUTHOR, reviewedFilename, scrubDocument } from "@/lib/files/scrub";

/**
 * The anonymity guardrail for file bytes. Every fixture is authored by a
 * reviewer with a name that cannot occur by accident, and every test ends by
 * asserting that name appears nowhere in what the author would download.
 */

const NAME = "Zebediah Quillfeather";
const INITIALS = "ZQ";
const EMAIL = "zebediah.quillfeather@example.org";
const COMPANY = "Quillfeather Editorial Ltd";

// ── Word fixture ───────────────────────────────────────────────────────────

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

function docxParts(): Record<string, string> {
  return {
    "[Content_Types].xml": `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>`,
    "docProps/core.xml": `<?xml version="1.0"?><cp:coreProperties xmlns:cp="x" xmlns:dc="y"><dc:title>Personal Statement</dc:title><dc:creator>${NAME}</dc:creator><cp:lastModifiedBy>${NAME}</cp:lastModifiedBy><cp:revision>7</cp:revision></cp:coreProperties>`,
    "docProps/app.xml": `<?xml version="1.0"?><Properties><Application>Microsoft Office Word</Application><Company>${COMPANY}</Company><Manager>${NAME}</Manager></Properties>`,
    "docProps/custom.xml": `<?xml version="1.0"?><Properties xmlns:vt="v"><property name="Owner"><vt:lpwstr>${NAME}</vt:lpwstr></property></Properties>`,
    "word/document.xml": `<?xml version="1.0"?><w:document ${W}><w:body><w:p>
      <w:r><w:t>I have always been </w:t></w:r>
      <w:del w:id="1" w:author="${NAME}" w:date="2026-10-01T10:00:00Z"><w:r><w:delText>passionate about</w:delText></w:r></w:del>
      <w:ins w:id="2" w:author="${NAME}" w:date="2026-10-01T10:00:00Z"><w:r><w:t>drawn to</w:t></w:r></w:ins>
      <w:r><w:rPr><w:rPrChange w:id="3" w:author='${NAME}' w:date="2026-10-01T10:01:00Z"><w:rPr/></w:rPrChange></w:rPr><w:t> cities.</w:t></w:r>
      <w:commentRangeStart w:id="0"/><w:r><w:t>At sixteen I counted buses.</w:t></w:r><w:commentRangeEnd w:id="0"/>
    </w:p></w:body></w:document>`,
    "word/comments.xml": `<?xml version="1.0"?><w:comments ${W}><w:comment w:id="0" w:author="${NAME}" w:date="2026-10-01T10:02:00Z" w:initials="${INITIALS}"><w:p><w:r><w:t>This is your opening. Start here.</w:t></w:r></w:p></w:comment></w:comments>`,
    "word/footnotes.xml": `<?xml version="1.0"?><w:footnotes ${W}><w:footnote w:id="1"><w:p><w:ins w:id="9" w:author="${NAME}"><w:r><w:t>Source?</w:t></w:r></w:ins></w:p></w:footnote></w:footnotes>`,
    "word/people.xml": `<?xml version="1.0"?><w15:people xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml"><w15:person w15:author="${NAME}"><w15:presenceInfo w15:providerId="AD" w15:userId="S::${EMAIL}::0c2f7a3e"/></w15:person></w15:people>`,
    "word/media/image1.png": "\u0089PNG binary stays as it is",
  };
}

function buildDocx(parts = docxParts()): Uint8Array {
  return zipSync(Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, strToU8(v)])));
}

function readDocx(bytes: Uint8Array): Record<string, string> {
  return Object.fromEntries(Object.entries(unzipSync(bytes)).map(([k, v]) => [k, strFromU8(v)]));
}

async function scrubbed(kind: "docx" | "pdf" | "txt", bytes: Uint8Array) {
  const result = await scrubDocument(kind, bytes);
  if (!result.ok) throw new Error(`scrub failed: ${result.reason}`);
  return result;
}

describe("scrubbing a Word document", () => {
  it("leaves the reviewer's name, initials, email and company nowhere in the file", async () => {
    const { bytes } = await scrubbed("docx", buildDocx());

    const everything = Object.values(readDocx(bytes)).join("\n");
    for (const secret of [NAME, "Quillfeather", "Zebediah", EMAIL, COMPANY, `"${INITIALS}"`]) {
      expect(everything).not.toContain(secret);
    }
  });

  it("rewrites the author on every tracked insertion, deletion and formatting change", async () => {
    const parts = readDocx((await scrubbed("docx", buildDocx())).bytes);
    const body = parts["word/document.xml"]!;

    expect(body).toContain(`<w:del w:id="1" w:author="${ANONYMOUS_AUTHOR}"`);
    expect(body).toContain(`<w:ins w:id="2" w:author="${ANONYMOUS_AUTHOR}"`);
    // Single-quoted attributes are valid XML and must not slip through.
    expect(body).toContain(`w:author='${ANONYMOUS_AUTHOR}'`);
    expect(parts["word/footnotes.xml"]).toContain(`w:author="${ANONYMOUS_AUTHOR}"`);
  });

  it("rewrites the author and initials on comments, keeping the comment itself", async () => {
    const comments = readDocx((await scrubbed("docx", buildDocx())).bytes)["word/comments.xml"]!;

    expect(comments).toContain(`w:author="${ANONYMOUS_AUTHOR}"`);
    expect(comments).toContain('w:initials="R"');
    expect(comments).toContain("This is your opening. Start here.");
  });

  it("rewrites the document properties and drops the directory identity in people.xml", async () => {
    const parts = readDocx((await scrubbed("docx", buildDocx())).bytes);

    expect(parts["docProps/core.xml"]).toContain(`<dc:creator>${ANONYMOUS_AUTHOR}</dc:creator>`);
    expect(parts["docProps/core.xml"]).toContain(
      `<cp:lastModifiedBy>${ANONYMOUS_AUTHOR}</cp:lastModifiedBy>`,
    );
    expect(parts["docProps/app.xml"]).toContain("<Company></Company>");
    expect(parts["docProps/app.xml"]).toContain("<Manager></Manager>");
    expect(parts["docProps/custom.xml"]).toContain("<vt:lpwstr></vt:lpwstr>");
    expect(parts["word/people.xml"]).not.toContain("presenceInfo");
    expect(parts["word/people.xml"]).toContain(`w15:author="${ANONYMOUS_AUTHOR}"`);
  });

  it("keeps the review itself intact: the text, the changes and their dates", async () => {
    const parts = readDocx((await scrubbed("docx", buildDocx())).bytes);
    const body = parts["word/document.xml"]!;

    expect(body).toContain("<w:delText>passionate about</w:delText>");
    expect(body).toContain("<w:t>drawn to</w:t>");
    expect(body).toContain('w:date="2026-10-01T10:00:00Z"');
    expect(parts["docProps/core.xml"]).toContain("<dc:title>Personal Statement</dc:title>");
    expect(parts["docProps/app.xml"]).toContain("Microsoft Office Word");
    expect(parts["word/media/image1.png"]).toBe(docxParts()["word/media/image1.png"]);
    expect(Object.keys(parts).sort()).toEqual(Object.keys(docxParts()).sort());
  });

  it("reports what it removed", async () => {
    const { removed } = await scrubbed("docx", buildDocx());

    expect(removed).toEqual(expect.arrayContaining([NAME, INITIALS, COMPANY]));
    expect(removed.some((value) => value.includes(EMAIL))).toBe(true);
  });

  it("handles names containing XML-escaped characters", async () => {
    const parts = docxParts();
    parts["word/comments.xml"] = parts["word/comments.xml"]!.replace(
      `w:author="${NAME}"`,
      'w:author="O&apos;Neil &amp; Sons"',
    );

    const { bytes, removed } = await scrubbed("docx", buildDocx(parts));

    expect(readDocx(bytes)["word/comments.xml"]).not.toContain("Neil");
    expect(removed).toContain("O'Neil & Sons");
  });

  it("is safe to run twice", async () => {
    const once = await scrubbed("docx", buildDocx());
    const twice = await scrubbed("docx", once.bytes);

    expect(readDocx(twice.bytes)).toEqual(readDocx(once.bytes));
    expect(twice.removed).toEqual([]);
  });

  it.each([
    ["bytes that are not a zip", strToU8("this is not a zip file at all")],
    ["a zip that is not a Word document", zipSync({ "readme.txt": strToU8("hello") })],
    ["an empty file", new Uint8Array()],
  ])("refuses %s rather than passing it through", async (_label, bytes) => {
    expect(await scrubDocument("docx", bytes)).toEqual({ ok: false, reason: "unreadable" });
  });
});

// ── PDF fixture ────────────────────────────────────────────────────────────

const XMP = `<?xpacket begin=""?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="r"><rdf:Description xmlns:dc="d"><dc:creator><rdf:Seq><rdf:li>${NAME}</rdf:li></rdf:Seq></dc:creator></rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>`;

async function buildPdf(): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  document.setTitle("Personal Statement");
  document.setAuthor(NAME);
  document.setCreator(`${COMPANY} Annotator`);
  document.setProducer(`${NAME}'s PDF tool`);

  const { context } = document;
  const page = document.addPage([300, 300]);
  page.drawText("At sixteen I counted buses.", { x: 20, y: 250, size: 12 });

  // A sticky note and a highlight, as an annotating reviewer would leave.
  const note = context.obj({
    Type: "Annot",
    Subtype: "Text",
    Rect: [50, 200, 70, 220],
    Contents: PDFString.of("This is your opening. Start here."),
    T: PDFString.of(NAME),
  });
  const highlight = context.obj({
    Type: "Annot",
    Subtype: "Highlight",
    Rect: [20, 245, 200, 262],
    T: PDFHexString.fromText(NAME),
  });
  page.node.set(
    PDFName.of("Annots"),
    context.obj([context.register(note), context.register(highlight)]),
  );

  // An uncompressed XMP stream, so the name is in the raw bytes.
  const xmp = context.stream(XMP, { Type: "Metadata", Subtype: "XML" });
  document.catalog.set(PDFName.of("Metadata"), context.register(xmp));

  return document.save({ useObjectStreams: false });
}

/** The name as it could appear in a PDF: plain, or as UTF-16BE hex. */
function pdfMentions(bytes: Uint8Array, text: string): boolean {
  const raw = Buffer.from(bytes).toString("latin1");
  const utf16Hex = Buffer.from(text, "utf16le").swap16().toString("hex").toUpperCase();
  return raw.includes(text) || raw.toUpperCase().includes(utf16Hex);
}

describe("scrubbing a PDF", () => {
  it("starts from a fixture that really does contain the name, three ways", async () => {
    const original = await buildPdf();

    expect(pdfMentions(original, NAME)).toBe(true);
    expect(Buffer.from(original).toString("latin1")).toContain("xmpmeta");
  });

  it("leaves the reviewer's name nowhere in the bytes", async () => {
    const { bytes } = await scrubbed("pdf", await buildPdf());

    expect(pdfMentions(bytes, NAME)).toBe(false);
    expect(pdfMentions(bytes, "Quillfeather")).toBe(false);
    expect(pdfMentions(bytes, COMPANY)).toBe(false);
  });

  it("removes Author, Creator and Producer, and keeps the title", async () => {
    const { bytes } = await scrubbed("pdf", await buildPdf());
    const document = await PDFDocument.load(bytes, { updateMetadata: false });

    expect(document.getAuthor()).toBeUndefined();
    expect(document.getCreator()).toBeUndefined();
    expect(document.getProducer()).toBeUndefined();
    expect(document.getTitle()).toBe("Personal Statement");
  });

  it("deletes the XMP metadata stream itself, not just the link to it", async () => {
    const { bytes } = await scrubbed("pdf", await buildPdf());
    const document = await PDFDocument.load(bytes, { updateMetadata: false });

    expect(document.catalog.has(PDFName.of("Metadata"))).toBe(false);
    expect(Buffer.from(bytes).toString("latin1")).not.toContain("xmpmeta");
  });

  it("renames the author of every annotation and keeps what they wrote", async () => {
    const { bytes } = await scrubbed("pdf", await buildPdf());
    const document = await PDFDocument.load(bytes, { updateMetadata: false });
    const annotations = document.getPage(0).node.Annots()!;

    expect(annotations.size()).toBe(2);
    for (let i = 0; i < annotations.size(); i++) {
      const annotation = annotations.lookup(i, PDFDict);
      const author = annotation.lookup(PDFName.of("T")) as PDFString | PDFHexString;
      expect(author.decodeText()).toBe(ANONYMOUS_AUTHOR);
    }
    const note = annotations.lookup(0, PDFDict).lookup(PDFName.of("Contents")) as PDFString;
    expect(note.decodeText()).toBe("This is your opening. Start here.");
  });

  it("reports what it removed", async () => {
    const { removed } = await scrubbed("pdf", await buildPdf());

    expect(removed).toEqual(expect.arrayContaining([NAME, `${COMPANY} Annotator`]));
  });

  it("copes with a PDF that has no metadata or annotations at all", async () => {
    const document = await PDFDocument.create();
    document.addPage([100, 100]);

    const result = await scrubDocument("pdf", await document.save());

    expect(result.ok).toBe(true);
  });

  it("refuses bytes that are not a PDF rather than passing them through", async () => {
    expect(await scrubDocument("pdf", strToU8("%PDF-1.7 but then nonsense"))).toEqual({
      ok: false,
      reason: "unreadable",
    });
  });
});

describe("plain text and filenames", () => {
  it("passes plain text through untouched: it has no metadata", async () => {
    const text = strToU8("Paragraph two repeats paragraph one.\n");

    expect(await scrubDocument("txt", text)).toEqual({ ok: true, bytes: text, removed: [] });
  });

  it("names the file from the reference, never from what the reviewer called it", () => {
    expect(reviewedFilename("RF-2026-0147", "docx")).toBe("RF-2026-0147-reviewed.docx");
    expect(reviewedFilename("RF-2026-0147", "pdf")).toBe("RF-2026-0147-reviewed.pdf");
  });
});
