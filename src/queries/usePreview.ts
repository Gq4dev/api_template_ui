// A mutation, not a query, even though preview changes nothing.
//
// The distinction here is about WHO decides when it runs. A query re-fetches on
// its own — on key change, on refocus — and the key would be the draft HTML,
// so every keystroke would render a mail. Each render costs a round trip to the
// validation service and a full Jinja2 pass. A mutation only runs when the
// author asks for it, which is also when they actually want to look.
import { useMutation } from "@tanstack/react-query";
import { templatesApi } from "../api/templatesClient";
import type { PreviewRequest } from "../api/types";

export function usePreview() {
  return useMutation({
    mutationFn: (payload: PreviewRequest) => templatesApi.preview(payload),
  });
}
