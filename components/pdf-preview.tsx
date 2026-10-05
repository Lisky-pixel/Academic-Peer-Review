"use client";

import { useEffect, useRef, useState } from "react";

/** Rendering a very long PDF page by page would freeze the tab. */
const MAX_PAGES = 60;

/**
 * Renders a PDF with PDF.js, one canvas per page, from a short-lived signed
 * storage URL. PDF.js parses the file in a worker and draws to canvases, so
 * nothing in the PDF is ever executed in the page.
 */
export function PdfPreview({ url }: { url: string }) {
  const container = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  const [truncatedAt, setTruncatedAt] = useState<number | null>(null);

  useEffect(() => {
    const host = container.current;
    if (!host) return;
    let cancelled = false;
    let destroy: (() => void) | undefined;

    (async () => {
      // Loaded on demand: PDF.js is large, and only this screen needs it.
      const pdfjs = await import("pdfjs-dist");
      pdfjs.GlobalWorkerOptions.workerSrc = new URL(
        "pdfjs-dist/build/pdf.worker.min.mjs",
        import.meta.url,
      ).toString();

      const task = pdfjs.getDocument({ url });
      destroy = () => void task.destroy();
      const pdf = await task.promise;
      if (cancelled) return;

      host.replaceChildren();
      const width = Math.max(280, host.clientWidth);
      const density = Math.min(window.devicePixelRatio || 1, 2);
      const pages = Math.min(pdf.numPages, MAX_PAGES);

      for (let number = 1; number <= pages; number++) {
        const page = await pdf.getPage(number);
        if (cancelled) return;

        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: (width / base.width) * density });

        const canvas = document.createElement("canvas");
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.style.width = "100%";
        canvas.style.height = "auto";
        canvas.style.display = "block";
        canvas.setAttribute("role", "img");
        canvas.setAttribute("aria-label", `Page ${number} of ${pdf.numPages}`);
        if (number > 1) canvas.style.marginTop = "12px";
        host.append(canvas);

        await page.render({ canvas, viewport }).promise;
      }

      if (!cancelled) {
        setTruncatedAt(pdf.numPages > MAX_PAGES ? MAX_PAGES : null);
        setState("ready");
      }
    })().catch(() => {
      if (!cancelled) setState("failed");
    });

    return () => {
      cancelled = true;
      destroy?.();
    };
  }, [url]);

  return (
    <div className="bg-muted p-3">
      {state === "loading" && (
        <p className="text-muted-foreground px-3 py-10 text-center text-sm">
          Loading the document…
        </p>
      )}
      {state === "failed" && (
        <p className="text-muted-foreground px-3 py-10 text-center text-sm">
          The preview could not be loaded. Download the document to read it.
        </p>
      )}
      <div ref={container} className="[&>canvas]:rounded-sm [&>canvas]:shadow-sm" />
      {truncatedAt && (
        <p className="text-muted-foreground px-3 pt-4 pb-1 text-center text-sm">
          Showing the first {truncatedAt} pages. Download the document for the rest.
        </p>
      )}
    </div>
  );
}
