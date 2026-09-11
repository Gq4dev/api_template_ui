// Every collector's answer for one action pair — the list the Collector step of
// the browse cascade is built from.
//
// A QUERY, unlike useResolveByAction, and the difference is which question is
// being asked. Resolving is an act the reader initiates about one client, so it
// waits for a button. This describes the CHOICES available for a pair the reader
// has already named, so it has to be on screen before anything is clicked —
// there is nothing to press if the dropdown is empty.
import { useQuery } from "@tanstack/react-query";
import { templatesApi } from "../api/templatesClient";
import { templateKeys } from "./queryKeys";

export function useCollectorsInventory(
  action: string,
  actionType: string,
  opts?: { at?: string },
) {
  const at = opts?.at;
  // Both are REQUIRED by the contract, so there is no half-question to ask. An
  // enabled query missing one of them would spend a round trip to be told 400.
  const ready = action.trim() !== "" && actionType.trim() !== "";

  return useQuery({
    queryKey: templateKeys.collectorsInventory(action, actionType, at),
    queryFn: () => templatesApi.collectorsInventory(action, actionType, { at }),
    enabled: ready,

    /*
      NO staleTime — deliberately, and this is the one setting on this hook that
      is easy to "optimize" into a lie.

      The usual argument for caching is that data only changes when somebody
      changes it, so an answer stays true until a write happens. That argument
      does not hold here. `status` and `servable` are DERIVED: the server reads
      each version's effectivity window against the clock, so a version
      scheduled for 09:00 becomes ACTIVE at 09:00 and a version with an
      effectiveTo stops being servable at its end instant — with nobody writing
      to the database, and with nothing to invalidate the cache. The answer goes
      stale ON ITS OWN, silently, while nothing happens.

      So staleTime 0 is the correct behaviour and not laziness: every mount
      re-asks rather than replaying a photograph.

      Even so, a rendered list is a photograph: it was true when it was taken.
      That is why the caller renders the `at` the SERVER returned next to the
      list instead of "now" — it is the only honest statement about which
      instant this answer describes, and it is why the endpoint echoes `at` back
      at all.
    */

    /*
      REFETCH ON FOCUS — opted back in HERE, against the app-wide default.

      `providers.tsx` sets `refetchOnWindowFocus: false` for every query, and
      that default is right for the rest of the app: those answers change only
      when somebody writes, so re-asking on every alt-tab would be traffic that
      cannot change what is on screen. This query is the exception, and staleTime
      0 alone does not cover it — with no refetch trigger, a mounted page fetches
      ONCE and then holds that snapshot for as long as the tab stays open.

      That is exactly the failure this endpoint exists to prevent. An operator
      who leaves the page open across a scheduled `effectiveFrom` transition
      would keep reading "se envía la suya" about a version that went live — or
      expired — while they were looking at something else. Coming back to the tab
      is the moment the list has had the most time to drift, so it is the moment
      worth re-asking at.
    */
    refetchOnWindowFocus: true,

    /*
      One attempt. This endpoint is NOT DEPLOYED on the running backend, so the
      common failure today is a 404 that no amount of retrying will turn into a
      list — retries would only delay the catalogue-derived fallback the browse
      page shows in its place, leaving the Collector step empty for seconds for
      no gain. A genuinely transient failure is recovered by the refetch on the
      next mount or window focus, which the two settings above already give us.
    */
    retry: false,
  });
}
