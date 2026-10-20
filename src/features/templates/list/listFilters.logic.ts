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
  // Partial, case-insensitive match on the server, like the other text filters.
  // Blank means "no collector filter" — NOT "only generic rows"; there is no
  // way to ask for generics alone, and pretending otherwise by sending an empty
  // string would make the API guess which of the two was meant.
  collector: string;
  page: number; // 0-based, matches the API
  size: number;
}

export const EMPTY_LIST_FILTER_STATE: ListFilterState = {
  status: "",
  templateKey: "",
  action: "",
  collector: "",
  page: 0,
  size: 20,
};

/**
 * Builds the `GET /api/v1/templates` query params from the filter state.
 * Empty/whitespace-only text filters are dropped so they never hit the wire;
 * page/size are coerced to numbers. There is no sort to send: the server
 * lists in one fixed order (templateKey ascending, version descending).
 */
export function buildListParams(state: ListFilterState): ListTemplatesParams {
  const params: ListTemplatesParams = {
    page: Number(state.page),
    size: Number(state.size),
  };

  const status = state.status.trim();
  if (status) params.status = status as TemplateStatus;

  const templateKey = state.templateKey.trim();
  if (templateKey) params.templateKey = templateKey;

  const action = state.action.trim();
  if (action) params.action = action;

  const collector = state.collector.trim();
  if (collector) params.collector = collector;

  return params;
}

/** Stable composite id for a version row, used as React key and archive-target. */
export function rowId(
  row: Pick<TemplateSummary, "templateKey" | "version">,
): string {
  return `${row.templateKey}:${row.version}`;
}

/**
 * The "New version" link for one row — the WRITE half of a round trip.
 *
 * The create form reads these same four parameters back off the URL (see
 * `initialFormValues` in create/createForm.logic.ts), so the two halves are one
 * contract split across two features, and the parameter names are the only
 * thing holding it together. It lives here, next to `rowId` and away from the
 * component, so the contract can be tested against the reader directly instead
 * of through a rendered table.
 *
 * `collector` is carried for a reason the other three do not need: a new
 * version of a VARIANT has to stay a version of that variant. Dropped, the flow
 * silently becomes "author a new generic", and the author finds out once it has
 * been published to every client. `?? ""` is deliberate and not a fallback —
 * blank is how the API itself spells "the generic", so a generic row writes the
 * parameter empty rather than omitting it, and both spellings read back as the
 * same thing.
 */
export function newVersionHref(
  row: Pick<
    TemplateSummary,
    "templateKey" | "action" | "actionType" | "collector"
  >,
): string {
  const search = new URLSearchParams({
    templateKey: row.templateKey,
    action: row.action,
    actionType: row.actionType,
    collector: row.collector ?? "",
  });
  return `/create?${search.toString()}`;
}
