// The variable catalogue for an action. A query, unlike preview: it depends
// only on action + actionType, not on the draft, so it is cacheable and cheap
// to keep fresh while the author types.
//
// This is the authoritative answer to "what can I use here?". Parsing the
// template text for {{ names }} cannot answer it — a variable the author has
// not typed yet is exactly the one they need to be told about.
import { useQuery } from "@tanstack/react-query";
import { templatesApi } from "../api/templatesClient";
import { templateKeys } from "./queryKeys";
import type { PreviewVariant } from "../api/types";

export function useContract(
  action: string,
  actionType: string,
  variant?: PreviewVariant,
) {
  const ready = action.trim() !== "" && actionType.trim() !== "";

  return useQuery({
    queryKey: templateKeys.contract(action, actionType, variant),
    queryFn: () => templatesApi.contract(action, actionType, variant),
    enabled: ready,
    // The catalogue changes when the render code ships, not while someone is
    // authoring, so refetching on every window focus is pure noise.
    staleTime: 5 * 60 * 1000,
    // An unknown action is a 404 and will stay one until the author edits the
    // field. Retrying cannot help and just delays the message.
    retry: false,
  });
}
