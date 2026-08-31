// The variable catalogue for an action — what `GET /contract` used to answer
// before the API stopped deriving anything.
//
// It reads the action's PRODUCTION template out of the vendored render core and
// extracts the shape from its AST. That matters: parsing the author's draft
// could only ever repeat back what they already typed, and the variable someone
// has NOT used yet is exactly the one worth showing them.
//
// A query, unlike the preview: it depends only on action + actionType, so it is
// cacheable and cheap to keep fresh while the author types.
import { useQuery } from "@tanstack/react-query";
import { fetchCatalogue } from "../preview/client";
import { templateKeys } from "./queryKeys";
import type { PreviewVariant } from "../preview/protocol";

export function useVariableCatalogue(
  action: string,
  actionType: string,
  variant?: PreviewVariant,
) {
  const ready = action.trim() !== "" && actionType.trim() !== "";

  return useQuery({
    queryKey: templateKeys.catalogue(action, actionType, variant),
    queryFn: () => fetchCatalogue(action, actionType, variant ?? "single"),
    enabled: ready,
    // The catalogue changes when the render core is re-synced, not while
    // someone is authoring, so refetching on window focus is pure noise.
    staleTime: 5 * 60 * 1000,
    // An unknown action is reported in the RESULT (known: false), not as a
    // rejection — so a retry would only re-run a computation that is already
    // settled. The engine failing to boot is a different matter, but retrying
    // that in a loop helps nobody either.
    retry: false,
  });
}
