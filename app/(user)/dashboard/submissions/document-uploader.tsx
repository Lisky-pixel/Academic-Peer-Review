"use client";

import {
  confirmUploadAction,
  prepareUploadAction,
} from "@/app/(user)/dashboard/submissions/actions";
import { FileUploader } from "@/components/file-uploader";
import { ACCEPT_ATTRIBUTE } from "@/lib/files/validate";

/** The author's document on a draft submission. */
export function DocumentUploader({
  submissionId,
  document,
  maxBytes,
}: {
  submissionId: string;
  document: { filename: string; sizeBytes: number } | null;
  maxBytes: number;
}) {
  return (
    <FileUploader
      current={document}
      maxBytes={maxBytes}
      accept={ACCEPT_ATTRIBUTE}
      formats="PDF, DOCX, DOC, RTF or TXT"
      inputLabel="Choose your document"
      prepare={(file) => prepareUploadAction(submissionId, file)}
      confirm={(key, filename) => confirmUploadAction(submissionId, key, filename)}
    />
  );
}
