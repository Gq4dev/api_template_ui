// Boots the preview engine and reports what it is running.
//
// Worth surfacing rather than hiding: the browser renders with the Jinja2 that
// Pyodide ships, while the Lambda pins its own in requirements.txt. A patch gap
// is harmless, a minor one is not — and a preview that quietly disagrees with
// what gets sent is the exact failure this whole design exists to avoid.
import { useQuery } from "@tanstack/react-query";
import { initPreviewEngine } from "../preview/client";
import { templateKeys } from "./queryKeys";

export function usePreviewEngine() {
  return useQuery({
    queryKey: templateKeys.engine(),
    queryFn: () => initPreviewEngine(),
    // The engine is a property of the build, not of the session.
    staleTime: Infinity,
    // Booting is expensive and deterministic: if it failed once it will fail
    // again, and the message is what the user needs, not another attempt.
    retry: false,
  });
}
