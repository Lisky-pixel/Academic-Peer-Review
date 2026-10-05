"use client";

import { useEffect } from "react";
import { markDeliveredAction } from "@/app/(user)/dashboard/submissions/actions";

/**
 * Tells the server the author has actually opened their review.
 *
 * It runs from the browser after the page is on screen, rather than while the
 * server renders it, on purpose: a link being prefetched or a crawler
 * requesting the URL must not count as the author having read their review.
 */
export function DeliveryBeacon({ submissionId }: { submissionId: string }) {
  useEffect(() => {
    void markDeliveredAction(submissionId);
  }, [submissionId]);

  return null;
}
