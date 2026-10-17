import mammoth from "mammoth";
import { db } from "@/lib/db";
import { extensionOf } from "@/lib/files/validate";
import { storage } from "@/lib/storage";

/**
 * In-browser preview of the author's document, for the reviewer's workspace.
 *
 *   PDF   → a short-lived signed URL; PDF.js renders it in the browser.
 *   DOCX  → converted to HTML here with Mammoth. Lossy on complex layout,
 *           which is acceptable because the download is always offered.
 *   TXT   → the text itself.
 *   other → no preview (legacy .doc, .rtf); the reviewer downloads it.
 *
 * The HTML from a .docx is untrusted — it comes from a file a user uploaded.
 * It is never inserted into our page: the workspace shows it inside an
 * iframe with an empty `sandbox`, where no script can run and nothing can
 * reach the application.
 */

export type DocumentPreview =
  | { type: "pdf"; url: string }
  | { type: "html"; html: string }
  | { type: "text"; text: string }
  | { type: "none" };

/** Above this, converting or inlining is not worth the wait; download instead. */
const MAX_INLINE_BYTES = 10 * 1024 * 1024;
const MAX_TEXT_CHARS = 500_000;

/** The paper, for a reviewer it has been given to. */
export async function findDocumentPreview(
  reviewerId: string,
  submissionId: string,
): Promise<DocumentPreview> {
  const file = await db.storedFile.findFirst({
    where: {
      kind: "ORIGINAL",
      submission: {
        id: submissionId,
        status: { not: "WITHDRAWN" },
        assignments: {
          some: { reviewerId, status: { in: ["PENDING", "ACCEPTED", "COMPLETED"] } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
    select: { storageKey: true, originalFilename: true, sizeBytes: true },
  });
  return file ? previewOf(file) : { type: "none" };
}

/**
 * Builds the preview for one stored file. Callers are responsible for having
 * checked that whoever is asking may see it.
 */
export async function previewOf(file: {
  storageKey: string;
  originalFilename: string;
  sizeBytes: number;
}): Promise<DocumentPreview> {
  const extension = extensionOf(file.originalFilename);

  if (extension === "pdf") {
    // A neutral name: the real one may identify someone who should be hidden.
    return {
      type: "pdf",
      url: await storage().presignDownload({ key: file.storageKey, filename: "document.pdf" }),
    };
  }

  if (file.sizeBytes > MAX_INLINE_BYTES) return { type: "none" };

  if (extension === "docx") {
    try {
      const bytes = await storage().read(file.storageKey);
      const { value } = await mammoth.convertToHtml({ buffer: Buffer.from(bytes) });
      return { type: "html", html: value };
    } catch {
      return { type: "none" };
    }
  }

  if (extension === "txt") {
    const bytes = await storage().read(file.storageKey);
    return { type: "text", text: new TextDecoder().decode(bytes).slice(0, MAX_TEXT_CHARS) };
  }

  return { type: "none" };
}

/**
 * Wraps converted HTML as a complete document for a sandboxed iframe. The
 * styles are inline because a sandboxed frame cannot load ours. Always dark
 * ink on white, in either theme: it is a picture of a page, like the PDF
 * preview beside which it may appear.
 */
export function previewDocument(html: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>
html{color-scheme:light}
body{margin:0;padding:28px 32px;font:16px/1.65 Georgia,"Times New Roman",serif;color:#131a2a;background:#fff;overflow-wrap:break-word}
h1,h2,h3,h4{line-height:1.25;margin:1.4em 0 .5em}p{margin:0 0 1em}
img{max-width:100%;height:auto}table{border-collapse:collapse;max-width:100%}
td,th{border:1px solid #dbe0e8;padding:4px 8px}a{color:inherit}
</style></head><body>${html}</body></html>`;
}
