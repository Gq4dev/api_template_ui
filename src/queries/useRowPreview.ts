// Renders one SPECIFIC stored version, for the list.
//
// Two steps inside a single mutation, deliberately: the caller gets one pending
// flag and one error instead of having to reason about a half-finished chain.
//
// The first step is `getVersion` — an ADDRESSED read, not a resolution. This
// used to go through `resolve(at: row.effectiveFrom)`, exploiting the fact that
// the resolution window is inclusive at its lower bound to land on the row's own
// version. That worked, but it asked "what was live at instant T" to answer
// "show me version N", and the gap between those two questions had to be papered
// over with two guard errors: a version-mismatch check, and a rejection of rows
// with no effectiveFrom. Both are now impossible by construction — you cannot
// resolve to the wrong version when you never resolved at all — and a DRAFT,
// which is in effect at no instant and could never be previewed this way, works
// like any other row.
//
// The second step used to be POST /preview. It now renders locally, so only the
// first step touches the network.
import { useMutation } from "@tanstack/react-query";
import { templatesApi } from "../api/templatesClient";
import type { TemplateSummary } from "../api/types";
import { renderDraft } from "../preview/client";
import type { PreviewVariant, RenderResult } from "../preview/protocol";

export function useRowPreview() {
  return useMutation<
    RenderResult,
    Error,
    { row: TemplateSummary; variant: PreviewVariant }
  >({
    mutationFn: async ({ row, variant }) => {
      const content = await templatesApi.getVersion(
        row.templateKey,
        row.version,
      );

      return renderDraft({
        action: row.action,
        actionType: row.actionType,
        html: content.html,
        subject: content.subject ?? undefined,
        variant,
      });
    },
  });
}
