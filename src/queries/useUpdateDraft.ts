// TanStack mutation wrapping templatesApi.updateDraft — the authoring "save".
//
// No idempotency key here, unlike create. Create mints one because a retried
// POST would otherwise mint a second version; this is a PUT at a known
// (templateKey, version), so repeating it converges on the same document instead
// of multiplying it. The operation is idempotent by address.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { templatesApi } from "../api/templatesClient";
import type { UpdateDraftRequest } from "../api/types";
import { templateKeys } from "./queryKeys";

export function useUpdateDraft() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      templateKey: string;
      version: number;
      payload: UpdateDraftRequest;
      author?: string;
    }) =>
      templatesApi.updateDraft(input.templateKey, input.version, input.payload, {
        author: input.author,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: templateKeys.all });
    },
  });
}
