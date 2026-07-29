// One specific stored version, with its HTML, fetched by address.
//
// This is the only read that can see a DRAFT: every other endpoint answers
// "what is in effect", and a draft is in effect at no instant at all. It is
// what the edit-draft screen loads to prefill the form.
import { useQuery } from "@tanstack/react-query";
import { templatesApi } from "../api/templatesClient";
import { templateKeys } from "./queryKeys";

export function useVersionContent(templateKey: string, version: number) {
  const ready = templateKey !== "" && Number.isInteger(version) && version > 0;

  return useQuery({
    queryKey: templateKeys.version(templateKey, version),
    queryFn: () => templatesApi.getVersion(templateKey, version),
    enabled: ready,
    // The author is about to overwrite this. Refetching mid-edit would race
    // their own typing and could silently swap the text under the cursor.
    staleTime: Infinity,
    retry: false,
  });
}
