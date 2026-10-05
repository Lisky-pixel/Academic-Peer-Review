/**
 * Date formatting for display. Fixed to en-GB and UTC so the server and the
 * browser always render the same text, whatever machine either runs on.
 */

const DATE = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

/** "14 Oct 2026" */
export function formatDate(value: string | Date): string {
  return DATE.format(new Date(value));
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Route params are text; an id column would throw on anything else. */
export function isUuid(value: string): boolean {
  return UUID.test(value);
}
