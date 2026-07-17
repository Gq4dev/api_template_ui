// TanStack mutation wrapping templatesApi.publish. Consumed by the publish feature
// (PR 4) — defined here now as part of the data-layer foundation.
import { useMutation } from "@tanstack/react-query";
import { templatesApi } from "../api/templatesClient";
import type { PublishRequest } from "../api/types";

export function usePublishTemplate() {
  return useMutation({
    mutationFn: (input: {
      templateKey: string;
      version: number;
      payload: PublishRequest;
    }) => templatesApi.publish(input.templateKey, input.version, input.payload),
  });
}
