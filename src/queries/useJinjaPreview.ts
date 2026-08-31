// A mutation, not a query, even though rendering changes nothing.
//
// The distinction is about WHO decides when it runs. A query re-fetches on its
// own — on key change, on refocus — and the key would be the draft HTML, so
// every keystroke would render a mail through a full Jinja2 pass. A mutation
// only runs when the author asks, which is also when they actually want to look.
//
// The render now happens in a Web Worker on this machine rather than in a
// validation service, so it costs no round trip — but the reasoning above is
// unchanged, and the first call still pays for booting Pyodide.
import { useMutation } from "@tanstack/react-query";
import { renderDraft } from "../preview/client";
import type { RenderRequest, RenderResult } from "../preview/protocol";

export function useJinjaPreview() {
  return useMutation<RenderResult, Error, RenderRequest>({
    mutationFn: (request) => renderDraft(request),
  });
}
