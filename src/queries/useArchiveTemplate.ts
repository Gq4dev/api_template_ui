// TanStack mutation wrapping templatesApi.archive. On success it invalidates the
// whole templates key space so every active list query refetches and the row's
// new ARCHIVED status shows up without a manual reload.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { templatesApi } from "../api/templatesClient";
import { templateKeys } from "./queryKeys";

export function useArchiveTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { templateKey: string; version: number }) =>
      templatesApi.archive(input.templateKey, input.version),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: templateKeys.all });
    },
  });
}
