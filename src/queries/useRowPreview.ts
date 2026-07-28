// Renders one SPECIFIC stored version, for the list.
//
// Two calls, deliberately inside a single mutation rather than a query feeding
// another: the caller gets one pending flag and one error instead of having to
// reason about a half-finished chain.
//
// Why the resolve call at all: the API has no "give me the HTML of version N".
// The only endpoint that returns HTML is `resolve`, which answers "what was
// effective at instant T". The resolution window is [effectiveFrom, effectiveTo)
// — effectiveFrom is INCLUSIVE (TemplateVersionRepositoryImpl uses .lte) — so
// asking at the row's own effectiveFrom lands exactly on that row's version.
import { useMutation } from "@tanstack/react-query";
import { templatesApi } from "../api/templatesClient";
import type {
  PreviewResponse,
  PreviewVariant,
  TemplateSummary,
} from "../api/types";

export class VersionMismatchError extends Error {
  constructor(asked: number, got: number) {
    super(
      `Expected version ${asked} but the server resolved version ${got} at that instant. ` +
        `Not rendering, to avoid showing you a different template than the one you picked.`,
    );
    this.name = "VersionMismatchError";
  }
}

export class MissingEffectiveFromError extends Error {
  constructor() {
    super("This version has no effective-from instant, so it cannot be resolved.");
    this.name = "MissingEffectiveFromError";
  }
}

export function useRowPreview() {
  return useMutation<
    PreviewResponse,
    Error,
    { row: TemplateSummary; variant: PreviewVariant }
  >({
    mutationFn: async ({ row, variant }) => {
      if (!row.effectiveFrom) throw new MissingEffectiveFromError();

      const content = await templatesApi.resolveByAction(
        row.action,
        row.actionType,
        row.effectiveFrom,
      );

      // The resolve query also filters out ARCHIVED versions, so an archived
      // row would quietly resolve to a DIFFERENT version. The caller disables
      // the button for those; this check is the backstop, and it also covers
      // two versions sharing an effectiveFrom. Showing the wrong template as if
      // it were the right one is worse than showing nothing.
      if (content.version !== row.version) {
        throw new VersionMismatchError(row.version, content.version);
      }

      return templatesApi.preview({
        action: row.action,
        actionType: row.actionType,
        html: content.html,
        subject: content.subject ?? undefined,
        variant,
      });
    },
  });
}
