// TanStack query wrapping templatesApi.list. Keyed by the exact params object so
// changing any filter or the page/size refetches. keepPreviousData keeps the last
// page's rows visible while the next page loads, avoiding a flash of empty table.
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { templatesApi } from "../api/templatesClient";
import type { ListTemplatesParams } from "../api/types";
import { templateKeys } from "./queryKeys";

export function useTemplatesList(params: ListTemplatesParams) {
  return useQuery({
    queryKey: templateKeys.list(params),
    queryFn: () => templatesApi.list(params),
    placeholderData: keepPreviousData,
  });
}
