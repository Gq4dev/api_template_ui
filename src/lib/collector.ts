// The collector dimension, in one place.
//
// A template has always been identified by action + actionType. `collector` does
// NOT become a third part of that identity — it is an OVERRIDE LAYER on top of
// it. A collector either has its own published, in-effect version (it gets that
// one) or it does not (it gets the generic). It never 404s for lacking a
// variant, and an absent collector means exactly what it always meant: the
// generic template. That is why every current API client keeps working
// untouched.
//
// Everything in this module mirrors a rule the SERVER already enforces. None of
// it is the authority — the server rejects a mismatched templateKey with a 400.
// What lives here exists so the UI can SHOW the operator the same answer the
// server is about to give, before they submit.
//
// CASE IS PART OF A COLLECTOR'S NAME. notification-template-service keeps the
// collector exactly as sent — `BBVA` and `bbva` are two different clients,
// with two different keys (`payment_approved__BBVA`, `payment_approved__bbva`)
// — because folding case once merged collectors that were genuinely distinct.
// Action and action type, by contrast, ARE lowercased by the server. Nothing in
// this module may lowercase a collector.

/**
 * The one function that decides whether a collector's format is acceptable.
 *
 * KEEP THIS THE ONLY PLACE THAT KNOWS THE FORMAT. The API team has now closed
 * the contract, and the tightening they announced has landed: a collector is one
 * or more alphanumeric groups joined by a SINGLE underscore. The hyphen is gone
 * — it used to canonicalize to the same identity as the underscore, which let
 * two genuinely different collectors collide on one variant, so the server
 * picked the underscore as the canonical separator and now answers `bbva-sa`
 * with a 400 telling the caller to use `_`. A doubled underscore, a leading or
 * trailing underscore, and any whitespace are rejected for the same reason: each
 * would be a second spelling of a name that already has one. Case is NOT
 * folded: `BBVA` and `bbva` both pass here, as two different collectors.
 *
 * Because the rule lives only here, a future move costs one function body and
 * one message — so no caller may re-implement the regex, and no other module may
 * test a collector string against a pattern of its own.
 *
 * Empty is NOT invalid here. Emptiness is a meaning, not a mistake: it says
 * "generic template". Whether a blank value is acceptable is the caller's
 * decision (the create form allows it; a resolve panel treats it as "no
 * collector asked for"), so this function refuses to make it for them.
 */
export function isValidCollector(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed === "") return true;
  return /^[A-Za-z0-9]+(_[A-Za-z0-9]+)*$/.test(trimmed);
}

/**
 * The message shown when {@link isValidCollector} says no.
 *
 * Exported rather than inlined at each call site for the same reason as the
 * function itself: whenever the format moves, the sentence describing it has to
 * move in the same commit, and a copy of it living in a form component is a copy
 * that will be left behind saying the old rule.
 *
 * It states the separator instead of listing forbidden characters, and carries
 * an example, because the operator arriving here almost always typed a hyphen
 * and needs to see the shape that works, not a taxonomy of the ones that do not.
 */
export const COLLECTOR_FORMAT_MESSAGE =
  "Collector solo admite letras y números separados por un único guion bajo. Por ejemplo: bbva_sa.";

/**
 * Trim, and nothing else — the one normalization a collector gets.
 *
 * Every comparison between two collector names goes through here, so this is
 * also where case-sensitivity is decided: NOT lowercased, because the server
 * stores and matches the collector exactly, and a UI that folded case would
 * show `BBVA`'s variant as `bbva`'s and pick the wrong client's mail.
 */
export function normalizeCollector(value: string): string {
  return value.trim();
}

/**
 * Mirrors the server's templateKey derivation.
 *
 * generic:   action + "_" + actionType            → `payment_approved`
 * variant:   action + "_" + actionType + "__" + c → `payment_approved__bbva`
 *
 * The separator is a DOUBLE underscore on purpose. Action and actionType are
 * joined with a single one, so a single underscore before the collector would
 * make `payment_approved_bbva` ambiguous — it could equally be the action
 * `payment` with actionType `approved_bbva`. Doubling it keeps the boundary
 * unambiguous no matter what the three parts contain.
 *
 * Returns "" when action or actionType is blank: there is nothing to derive
 * yet, and showing a half-built key like `_approved` while someone is still
 * typing would read as a real key they are about to create.
 */
export function deriveTemplateKey(
  action: string,
  actionType: string,
  collector: string,
): string {
  // The server lowercases action and action type, and keeps the collector's
  // case: `payment_approved__BBVA`.
  const a = action.trim().toLowerCase();
  const t = actionType.trim().toLowerCase();
  if (a === "" || t === "") return "";

  const c = normalizeCollector(collector);
  return c === "" ? `${a}_${t}` : `${a}_${t}__${c}`;
}

/**
 * How a collector reads in a list, a table or a select.
 *
 * A null collector is a DECISION — "this is the generic template, the one every
 * client falls back to" — and rendering it as an empty cell says the opposite:
 * that the data is missing. Anyone scanning a table would read the blank as a
 * row somebody forgot to fill in. Every place that displays a collector goes
 * through here so that never happens in one of them.
 */
export function collectorLabel(collector: string | null): string {
  const normalized = normalizeCollector(collector ?? "");
  return normalized === "" ? "Genérica" : normalized;
}
