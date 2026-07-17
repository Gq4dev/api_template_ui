// Centralized TanStack Query key factory. Keeps cache keys consistent across hooks
// and avoids hand-typed key arrays scattered through features/.
export const templateKeys = {
  all: ["templates"] as const,
  resolve: (templateKey: string, at?: string) =>
    [...templateKeys.all, "resolve", templateKey, at ?? "now"] as const,
};
