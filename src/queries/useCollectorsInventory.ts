// Every collector's answer for one action pair — the list the Collector step of
// the browse cascade is built from.
//
// DERIVED, NOT FETCHED. The API has no endpoint that answers this question, so
// it is answered from the full catalogue the browse page already loads (see
// `inventoryFromCatalogue`). Reading the same TanStack entry costs no extra
// request: the catalogue query is shared, and every write invalidates it.
import type { ActionSpelling } from "../lib/actionNames";
import {
  inventoryFromCatalogue,
  type InventoryAnswer,
} from "../features/templates/browse/browse.logic";
import { useFullCatalogue } from "./fullCatalogue";

/**
 * The inventory once per stored spelling of the pair.
 *
 * The send path matches action/actionType EXACTLY as stored, so a pair the
 * catalogue writes as both PAYMENT and payment has two inventories, and folding
 * them here would hide that delivery depends on how the sender spells it. The
 * caller passes the bounded, capped spelling list and merges the answers
 * (`mergeInventoryAnswers`).
 *
 * NOT MEMOIZED ON PURPOSE. Effectivity windows are evaluated against the clock
 * on every render, so a version scheduled for 09:00 reads as live at 09:00
 * without anything being refetched or invalidated — the status of a published
 * version changes with nobody writing to the database, and a memo keyed on the
 * rows would freeze it. The derivation is a filter over rows already in memory.
 */
export function useCollectorsInventories(spellings: ActionSpelling[]): InventoryAnswer[] {
  const catalogue = useFullCatalogue();
  const rows = catalogue.data?.content;
  const now = Date.now();

  return spellings.map((spelling) => {
    const ready = spelling.action.trim() !== "" && spelling.actionType.trim() !== "";
    return {
      data:
        ready && rows
          ? inventoryFromCatalogue(rows, spelling, catalogue.dataUpdatedAt, now)
          : null,
      isLoading: ready && catalogue.isLoading,
      isError: catalogue.isError,
    };
  });
}
