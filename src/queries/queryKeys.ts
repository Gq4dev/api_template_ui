// Centralized TanStack Query key factory. Keeps cache keys consistent across hooks
// and avoids hand-typed key arrays scattered through features/.
import type { ListTemplatesParams, PreviewVariant } from "../api/types";

export const templateKeys = {
  all: ["templates"] as const,
  list: (params: ListTemplatesParams) =>
    [...templateKeys.all, "list", params] as const,
  resolve: (templateKey: string, at?: string) =>
    [...templateKeys.all, "resolve", templateKey, at ?? "now"] as const,
  // One specific version by address — no instant in the key, because this read
  // does not depend on when you ask.
  version: (templateKey: string, version: number) =>
    [...templateKeys.all, "version", templateKey, version] as const,
  // Keyed on the action, not the draft: the catalogue is a property of the
  // action, so every template authored for it shares one cache entry.
  contract: (action: string, actionType: string, variant?: PreviewVariant) =>
    [...templateKeys.all, "contract", action, actionType, variant ?? "single"] as const,
};
