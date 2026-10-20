// Badge colours shared by the catalogue panel and the send-path answers, so the
// same status or collector never reads in two different colours on one page.

export const STATUS_COLOR: Record<string, string> = {
  ACTIVE: "green",
  SCHEDULED: "blue",
  DRAFT: "gray",
  ARCHIVED: "dark",
};

// Two different things, so two different colours. A generic template is the
// baseline everyone gets; a collector variant is an exception carved out for one
// client. Rendering both in the same neutral badge would make the reader compare
// the text to tell them apart, which is the one thing this badge exists to spare
// them.
export function collectorBadgeColor(collector: string | null): string {
  return collector ? "grape" : "gray";
}
