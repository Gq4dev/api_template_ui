// TanStack mutation (not a query) wrapping templatesApi.preview.
//
// Preview is intentionally a mutation, not useQuery: it is an on-demand POST driven
// by a button click, it depends on unsaved editor bindings (not just the URL
// templateKey/version), and each attempt must surface its own ApiError. useQuery's
// auto-refetch-on-key-change and response caching are the wrong model for an
// imperative "render with this body" action. Consumed by the preview feature (PR 3).
import { useMutation } from "@tanstack/react-query";
import { templatesApi } from "../api/templatesClient";
import type { RenderRequest } from "../api/types";

export function usePreviewTemplate() {
  return useMutation({
    mutationFn: (input: {
      templateKey: string;
      version: number;
      data?: RenderRequest["data"];
    }) => templatesApi.preview(input.templateKey, input.version, input.data),
  });
}
