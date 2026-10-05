import { Download, FileText } from "lucide-react";
import { PdfPreview } from "@/components/pdf-preview";
import { Button } from "@/components/ui/button";
import { formatBytes } from "@/lib/files/validate";
import { type DocumentPreview, previewDocument } from "@/lib/reviews/preview";
import { cn } from "@/lib/utils";

/**
 * A document shown in the page: a header with its name and a download button,
 * and a scrolling preview beneath. Used in the reviewer's workspace and on
 * the administrator's approval screen.
 */
export function DocumentPane({
  label,
  filename,
  sizeBytes,
  downloadHref,
  preview,
  className,
}: {
  /** Accessible name, and a small caption above the filename when given. */
  label: string;
  filename: string;
  sizeBytes: number;
  downloadHref: string;
  preview: DocumentPreview;
  className?: string;
}) {
  return (
    <section
      aria-label={label}
      className={cn("border-border bg-card min-w-0 overflow-hidden rounded-2xl border", className)}
    >
      <div className="border-border flex items-center justify-between gap-3 border-b px-4 py-3">
        <span className="flex min-w-0 items-center gap-2.5">
          <FileText aria-hidden className="text-mark size-4 shrink-0" strokeWidth={1.75} />
          <span className="min-w-0">
            <span className="text-muted-foreground block text-xs">{label}</span>
            <span className="block truncate text-sm font-medium">
              {filename}{" "}
              <span className="text-muted-foreground font-normal">· {formatBytes(sizeBytes)}</span>
            </span>
          </span>
        </span>
        <Button asChild variant="outline" size="sm">
          {/* A plain link: this is a file download, not a page to prefetch. */}
          <a href={downloadHref}>
            <Download aria-hidden />
            Download
          </a>
        </Button>
      </div>

      {/* Focusable, so the preview can be scrolled from the keyboard. */}
      <div
        role="group"
        aria-label={`${label}, scrollable preview`}
        tabIndex={0}
        className="focus-visible:ring-ring/50 max-h-[70vh] overflow-y-auto outline-none focus-visible:ring-3 focus-visible:ring-inset"
      >
        {preview.type === "pdf" && <PdfPreview url={preview.url} />}
        {preview.type === "html" && (
          // An empty sandbox: the converted document can run no script, submit
          // no form and reach nothing outside its own frame.
          <iframe
            title={`${label} preview`}
            sandbox=""
            srcDoc={previewDocument(preview.html)}
            className="block h-[70vh] w-full bg-white"
          />
        )}
        {preview.type === "text" && (
          <pre className="p-6 font-sans text-sm leading-relaxed whitespace-pre-wrap">
            {preview.text}
          </pre>
        )}
        {preview.type === "none" && (
          <p className="text-muted-foreground px-6 py-14 text-center text-sm leading-relaxed">
            This file cannot be previewed here. Download it to read it.
          </p>
        )}
      </div>
    </section>
  );
}
