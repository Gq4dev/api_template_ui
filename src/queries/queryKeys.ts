// Centralized TanStack Query key factory. Keeps cache keys consistent across hooks
// and avoids hand-typed key arrays scattered through features/.
import type { ListTemplatesParams } from "../api/types";
import type { PreviewVariant } from "../preview/protocol";

export const templateKeys = {
  all: ["templates"] as const,
  list: (params: ListTemplatesParams) =>
    [...templateKeys.all, "list", params] as const,
  resolve: (templateKey: string, at?: string) =>
    [...templateKeys.all, "resolve", templateKey, at ?? "now"] as const,
  // Every collector's answer for one action pair. The instant IS part of the
  // key: the same pair asked about two instants is two different answers, since
  // `status` and `servable` are derived against it. "now" stands in for an
  // omitted `at` so the default question still has a stable key — but see
  // useCollectorsInventory for why that entry must not be given a long
  // staleTime: the key stays the same while the answer underneath it ages.
  collectorsInventory: (action: string, actionType: string, at?: string) =>
    [...templateKeys.all, "collectors", action, actionType, at ?? "now"] as const,
  // One specific version by address — no instant in the key, because this read
  // does not depend on when you ask.
  version: (templateKey: string, version: number) =>
    [...templateKeys.all, "version", templateKey, version] as const,
  // Keyed on the action, not the draft: the catalogue is a property of the
  // action, so every template authored for it shares one cache entry.
  catalogue: (action: string, actionType: string, variant?: PreviewVariant) =>
    [...templateKeys.all, "catalogue", action, actionType, variant ?? "single"] as const,
  // Not under `all`: the engine is a property of the build, not of any template.
  engine: () => ["previewEngine"] as const,
};
