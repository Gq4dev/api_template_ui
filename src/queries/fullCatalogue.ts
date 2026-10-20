// The WHOLE stored catalogue, every page, for the screens that reason over all
// of it: the browse cascade (every option and count is built from it) and the
// create form (the spelling it sends is chosen from it).
//
// It used to be one page of 500 that ignored `totalElements`. Past 500 versions
// that silently dropped rows, and a dropped row is not a cosmetic gap here: a
// missing key makes the create form pick the wrong spelling (a 400, or new
// drift) and makes the cascade offer an incomplete list as if it were whole.
import { useQuery } from "@tanstack/react-query";
import { templatesApi } from "../api/templatesClient";
import type { PageResponse, TemplateSummary } from "../api/types";
import { templateKeys } from "./queryKeys";

/**
 * The server's maximum page size: larger requests are silently capped to it.
 * Asking for the cap means today's catalogue is ONE request, and one request
 * has no page boundary for a concurrent write to move.
 */
export const CATALOGUE_PAGE_SIZE = 2000;

/**
 * A hard stop: 5 pages × 2000 = 10 000 versions.
 *
 * Far above today's catalogue, and low enough that a runaway `totalPages` from a
 * misbehaving server cannot turn one page load into hundreds of requests. Hitting
 * it is reported as truncation, never silently.
 */
export const MAX_CATALOGUE_PAGES = 5;

// No sort parameter: the API serves the list in one fixed order (templateKey
// ascending, version descending) and accepts no other. That order is NOT
// append-only — a version created mid-walk lands inside an already-read page
// and pushes a row across the boundary — so a multi-page walk can skip a row.
// The de-duplication below absorbs the duplicate half of that, and a skipped
// row shows up as `truncated`, because the count no longer adds up.

export interface FullCatalogue {
  content: TemplateSummary[];
  /** What the server says exists. */
  totalElements: number;
  /** Fewer rows were read than exist — the page cap was hit, or pages came back short. */
  truncated: boolean;
}

/**
 * Walks every page through `fetchPage`, sequentially, up to `maxPages`.
 *
 * Framework-free so the walk, the cap and the truncation rule are testable
 * without a network or a QueryClient. Rows are de-duplicated by
 * `templateKey:version` as a second guard against a page boundary moving under
 * the walk.
 */
export async function fetchWholeCatalogue(
  fetchPage: (page: number, size: number) => Promise<PageResponse<TemplateSummary>>,
  opts: { pageSize?: number; maxPages?: number } = {},
): Promise<FullCatalogue> {
  const pageSize = opts.pageSize ?? CATALOGUE_PAGE_SIZE;
  const maxPages = opts.maxPages ?? MAX_CATALOGUE_PAGES;

  const first = await fetchPage(0, pageSize);
  const seen = new Set<string>();
  const content: TemplateSummary[] = [];
  const add = (rows: TemplateSummary[]) => {
    for (const row of rows) {
      const id = `${row.templateKey}:${row.version}`;
      if (seen.has(id)) continue;
      seen.add(id);
      content.push(row);
    }
  };
  add(first.content);

  const pagesToRead = Math.min(first.totalPages, maxPages);
  for (let page = 1; page < pagesToRead; page += 1) {
    const next = await fetchPage(page, pageSize);
    if (next.content.length === 0) break;
    add(next.content);
  }

  return {
    content,
    totalElements: first.totalElements,
    truncated: content.length < first.totalElements,
  };
}

export function useFullCatalogue() {
  return useQuery({
    queryKey: templateKeys.fullCatalogue(),
    queryFn: () =>
      fetchWholeCatalogue((page, size) =>
        templatesApi.list({ page, size }),
      ),
  });
}
