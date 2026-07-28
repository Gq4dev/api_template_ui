// Pure, framework-free logic for the templates list: turns the filter/pagination
// form state into the `ListTemplatesParams` object the API client expects. Kept
// separate from ListPage so it is unit-testable without React or a DOM.
import type {
  ListTemplatesParams,
  TemplateStatus,
  TemplateSummary,
} from "../../../api/types";

// The raw form state the ListPage container owns. `status` is a plain string so
// the "All" option maps to "" (no filter); text inputs may hold whitespace.
export interface ListFilterState {
  status: string;
  templateKey: string;
  action: string;
  page: number; // 0-based, matches the API
  size: number;
}

export const DEFAULT_LIST_SORT = "createdAt,desc";

export const EMPTY_LIST_FILTER_STATE: ListFilterState = {
  status: "",
  templateKey: "",
  action: "",
  page: 0,
  size: 20,
};

/**
 * Builds the `GET /api/v1/templates` query params from the filter state.
 * Empty/whitespace-only text filters are dropped so they never hit the wire;
 * page/size are coerced to numbers; sort defaults to createdAt,desc.
 */
export function buildListParams(state: ListFilterState): ListTemplatesParams {
  const params: ListTemplatesParams = {
    page: Number(state.page),
    size: Number(state.size),
    sort: DEFAULT_LIST_SORT,
  };

  const status = state.status.trim();
  if (status) params.status = status as TemplateStatus;

  const templateKey = state.templateKey.trim();
  if (templateKey) params.templateKey = templateKey;

  const action = state.action.trim();
  if (action) params.action = action;

  return params;
}

/** Stable composite id for a version row, used as React key and archive-target. */
export function rowId(
  row: Pick<TemplateSummary, "templateKey" | "version">,
): string {
  return `${row.templateKey}:${row.version}`;
}
