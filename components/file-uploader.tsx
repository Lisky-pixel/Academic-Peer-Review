"use client";

import { FileText, FileUp, RefreshCw } from "lucide-react";
import { useRef, useState } from "react";
import { FormMessage } from "@/components/form";
import { Button } from "@/components/ui/button";
import { formatBytes } from "@/lib/files/validate";
import { cn } from "@/lib/utils";

/**
 * Sends the file straight to storage, reporting progress. The request must
 * carry exactly the content type the upload URL was signed for.
 */
function putFile(
  url: string,
  file: File,
  contentType: string,
  onProgress: (fraction: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", url);
    request.setRequestHeader("Content-Type", contentType);
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    };
    request.onload = () =>
      request.status >= 200 && request.status < 300
        ? resolve()
        : reject(new Error(`Upload failed with status ${request.status}`));
    request.onerror = () => reject(new Error("Network error during upload"));
    request.send(file);
  });
}

export type PrepareUpload = (file: {
  filename: string;
  mimeType: string;
  sizeBytes: number;
}) => Promise<{ url: string; key: string; mimeType: string } | { error: string }>;

export type ConfirmUpload = (key: string, filename: string) => Promise<{ error?: string }>;

/**
 * A two-step upload to storage: `prepare` asks the server for a signed URL,
 * the browser PUTs the file there, then `confirm` tells the server to check
 * what arrived. Used for an author's document and a reviewer's annotated copy.
 */
export function FileUploader({
  current,
  maxBytes,
  accept,
  formats,
  inputLabel,
  prepare,
  confirm,
  disabled = false,
}: {
  /** The file already attached, if any. */
  current: { filename: string; sizeBytes: number } | null;
  maxBytes: number;
  /** The file input's `accept` attribute. */
  accept: string;
  /** The accepted formats in words, e.g. "PDF, DOCX or TXT". */
  formats: string;
  /** Accessible name of the file input. */
  inputLabel: string;
  prepare: PrepareUpload;
  confirm: ConfirmUpload;
  disabled?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string>();
  const [dragging, setDragging] = useState(false);
  const busy = progress !== null;

  async function upload(file: File) {
    setError(undefined);
    // The same limit is enforced on the server; checking here just saves a
    // wait on an upload that will be refused.
    if (file.size > maxBytes) {
      setError(`That file is too large. The limit is ${formatBytes(maxBytes)}.`);
      return;
    }

    setProgress(0);
    try {
      const prepared = await prepare({
        filename: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
      });
      if ("error" in prepared) {
        setError(prepared.error);
        return;
      }

      await putFile(prepared.url, file, prepared.mimeType, setProgress);

      const confirmed = await confirm(prepared.key, file.name);
      if (confirmed.error) setError(confirmed.error);
    } catch {
      setError("The upload did not finish. Check your connection and try again.");
    } finally {
      setProgress(null);
    }
  }

  function onChosen(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) void upload(file);
  }

  function onDrop(event: React.DragEvent) {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file && !busy && !disabled) void upload(file);
  }

  const percent = Math.round((progress ?? 0) * 100);

  return (
    <div className="space-y-4">
      <input
        ref={input}
        type="file"
        accept={accept}
        className="sr-only"
        onChange={onChosen}
        aria-label={inputLabel}
        disabled={disabled}
      />

      {current && !busy ? (
        <div className="border-border bg-card flex flex-wrap items-center justify-between gap-4 rounded-xl border p-4">
          <span className="flex min-w-0 items-center gap-3">
            <span className="bg-mark/10 text-mark flex size-10 shrink-0 items-center justify-center rounded-lg">
              <FileText aria-hidden className="size-5" strokeWidth={1.75} />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">{current.filename}</span>
              <span className="text-muted-foreground block text-xs">
                {formatBytes(current.sizeBytes)}
              </span>
            </span>
          </span>
          {!disabled && (
            <Button
              type="button"
              variant="outline"
              size="lg"
              onClick={() => input.current?.click()}
            >
              <RefreshCw aria-hidden />
              Replace
            </Button>
          )}
        </div>
      ) : (
        <button
          type="button"
          disabled={busy || disabled}
          onClick={() => input.current?.click()}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={cn(
            "border-border hover:border-ring hover:bg-card focus-visible:ring-ring/30 flex w-full cursor-pointer flex-col items-center gap-3 rounded-2xl border border-dashed px-6 py-10 text-center transition-colors outline-none focus-visible:ring-3 disabled:cursor-progress",
            dragging && "border-mark bg-mark/5",
          )}
        >
          <span className="bg-mark/10 text-mark flex size-11 items-center justify-center rounded-xl">
            <FileUp aria-hidden className="size-5" strokeWidth={1.75} />
          </span>
          {busy ? (
            <span className="w-full max-w-xs space-y-2">
              <span className="block text-sm font-medium">
                {percent < 100 ? `Uploading… ${percent}%` : "Checking the file…"}
              </span>
              <span className="bg-border block h-1.5 overflow-hidden rounded-full">
                <span
                  className="bg-mark block h-full rounded-full transition-[width]"
                  style={{ width: `${percent}%` }}
                />
              </span>
            </span>
          ) : (
            <>
              <span className="text-sm font-medium">
                Choose a file{" "}
                <span className="text-muted-foreground font-normal">or drop it here</span>
              </span>
              <span className="text-muted-foreground text-xs">
                {formats}, up to {formatBytes(maxBytes)}
              </span>
            </>
          )}
        </button>
      )}

      {error && <FormMessage tone="error">{error}</FormMessage>}
    </div>
  );
}
