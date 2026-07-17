// TanStack mutation wrapping templatesApi.create. Consumed by the create feature
// (PR 2) — defined here now as part of the data-layer foundation.
import { useMutation } from "@tanstack/react-query";
import { templatesApi } from "../api/templatesClient";
import type { CreateTemplateRequest } from "../api/types";

export interface UseCreateTemplateOptions {
  author?: string;
  idempotencyKey?: string;
}

export function useCreateTemplate() {
  return useMutation({
    mutationFn: (input: {
      payload: CreateTemplateRequest;
      opts?: UseCreateTemplateOptions;
    }) => templatesApi.create(input.payload, input.opts),
  });
}
