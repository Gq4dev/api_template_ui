import { describe, expect, it, vi } from "vitest";
import type { PageResponse, TemplateSummary } from "../api/types";
import { fetchWholeCatalogue } from "./fullCatalogue";

function row(templateKey: string, version = 1): TemplateSummary {
  return {
    templateKey,
    version,
    status: "ACTIVE",
    action: "payment",
    actionType: "approved",
    collector: null,
    subject: null,
    effectiveFrom: null,
    effectiveTo: null,
    createdBy: "seed",
    createdAt: "2026-01-01T00:00:00Z",
  };
}

/** A server holding `rows`, paged exactly like the API. */
function server(rows: TemplateSummary[], reportedTotal = rows.length) {
  return vi.fn(async (page: number, size: number): Promise<PageResponse<TemplateSummary>> => ({
    content: rows.slice(page * size, (page + 1) * size),
    page,
    size,
    totalElements: reportedTotal,
    totalPages: Math.ceil(reportedTotal / size),
  }));
}

describe("fetchWholeCatalogue", () => {
  it("reads a one-page catalogue with one request", async () => {
    const fetchPage = server([row("a"), row("b")]);
    const result = await fetchWholeCatalogue(fetchPage, { pageSize: 10 });
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ totalElements: 2, truncated: false });
    expect(result.content.map((r) => r.templateKey)).toEqual(["a", "b"]);
  });

  // The bug this replaces: page 0 of 500 and nothing after it.
  it("walks every page and concatenates them in order", async () => {
    const rows = Array.from({ length: 7 }, (_, i) => row(`k${i}`));
    const fetchPage = server(rows);
    const result = await fetchWholeCatalogue(fetchPage, { pageSize: 3 });
    expect(fetchPage.mock.calls.map(([page]) => page)).toEqual([0, 1, 2]);
    expect(result.content).toHaveLength(7);
    expect(result.truncated).toBe(false);
  });

  it("stops at the page cap and says the catalogue is truncated", async () => {
    const rows = Array.from({ length: 10 }, (_, i) => row(`k${i}`));
    const fetchPage = server(rows);
    const result = await fetchWholeCatalogue(fetchPage, { pageSize: 2, maxPages: 3 });
    expect(fetchPage).toHaveBeenCalledTimes(3);
    expect(result).toMatchObject({ totalElements: 10, truncated: true });
    expect(result.content).toHaveLength(6);
  });

  // A server whose totals disagree with what it returns is still reported.
  it("flags truncation when fewer rows arrive than the server claims", async () => {
    const fetchPage = server([row("a")], 600);
    const result = await fetchWholeCatalogue(fetchPage, { pageSize: 500 });
    expect(result).toMatchObject({ totalElements: 600, truncated: true });
  });

  it("de-duplicates a row repeated across a moving page boundary", async () => {
    const fetchPage = vi.fn(async (page: number): Promise<PageResponse<TemplateSummary>> => ({
      content: page === 0 ? [row("a"), row("b")] : [row("b"), row("c")],
      page,
      size: 2,
      totalElements: 3,
      totalPages: 2,
    }));
    const result = await fetchWholeCatalogue(fetchPage, { pageSize: 2 });
    expect(result.content.map((r) => r.templateKey)).toEqual(["a", "b", "c"]);
    expect(result.truncated).toBe(false);
  });
});
