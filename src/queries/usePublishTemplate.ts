// TanStack mutation wrapping templatesApi.publish — the only call that puts a
// template in front of customers.
//
// Invalidates the whole templates key space on success, and it has to: publishing
// changes TWO rows, not one. The published version becomes ACTIVE/SCHEDULED, and
// the previously-open version is auto-closed with a non-null effectiveTo. A
// narrower invalidation would leave the superseded row on screen still claiming
// to be live.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { templatesApi } from "../api/templatesClient";
import type { PublishRequest } from "../api/types";
import { templateKeys } from "./queryKeys";

export function usePublishTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      templateKey: string;
      version: number;
      payload?: PublishRequest;
      author?: string;
    }) =>
      templatesApi.publish(
        input.templateKey,
        input.version,
        input.payload ?? {},
        { author: input.author },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: templateKeys.all });
    },
  });
}
