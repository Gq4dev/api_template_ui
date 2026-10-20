// Answers the operator's question: "what does THIS collector actually get?"
//
// A mutation, not a query, for two reasons — the second one is the important
// one.
//
// The first is the same reason useJinjaPreview is a mutation: the operator asks
// by pressing a button, and a query keyed on three text inputs would resolve and
// render on every keystroke of a half-typed collector name.
//
// The second is about truth. `status` is DERIVED — SCHEDULED and ACTIVE are the
// same stored row read against the clock, and a version scheduled for 09:00
// becomes active at 09:00 with nobody writing to the database. So a cached
// resolution does not go stale in the usual sense of "someone changed it"; it
// goes stale on its own, silently, while nothing happens. A mutation holds only
// the result of the last question that was actually asked, which is exactly the
// guarantee this panel needs: refetch rather than remember.
//
// ONE QUESTION MAY BE SEVERAL CALLS. The backend matches action/actionType on
// /resolve EXACTLY as stored, and the catalogue can hold one template in more
// than one spelling (PAYMENT and payment). Each spelling is a different answer
// for whoever sends the mail, so the caller passes every stored spelling and
// this asks once per spelling. The caller bounds that list to the spellings the
// catalogue actually holds for the pair.
//
// The render runs locally against the vendored core, the same path useRowPreview
// takes. There is no server-side render to call — the API stores templates and
// decides which version is live; it does not parse or render them.
import { useMutation } from "@tanstack/react-query";
import { templatesApi } from "../api/templatesClient";
import type { TemplateContentResponse } from "../api/types";
import type { ActionSpelling } from "../lib/actionNames";
import { renderDraft } from "../preview/client";
import type { PreviewVariant, RenderResult } from "../preview/protocol";

export interface ResolveByActionVariables {
  /**
   * The raw spellings to ask in, most common first. Never empty. One entry is
   * the normal case and behaves exactly like a single call.
   */
  spellings: ActionSpelling[];
  /** Empty means "no collector asked for" — resolve the generic. */
  collector: string;
  variant: PreviewVariant;
}

export interface ResolveByActionResult {
  /** The version the API decided to serve, including `fallbackToGeneric`. */
  content: TemplateContentResponse;
  /**
   * What that version renders to, produced locally — or null when the local
   * engine could not run at all. See {@link engineErrorMessage}.
   */
  render: RenderResult | null;
  /**
   * Why there is no render, when there is none.
   *
   * A RENDER FAILURE IS NOT A RESOLUTION FAILURE, and this field is what keeps
   * the two apart. `renderDraft` rejects only when the ENGINE failed — Pyodide
   * never booted, an asset 404'd, the worker died — never when the template is
   * bad, which comes back as a resolved `ok: false` carrying a line number.
   *
   * Letting an engine rejection fail the whole mutation would throw away an
   * answer the server already gave, and that answer is the entire point of this
   * panel: which version the send path picks, and whether it fell back to the
   * generic. The reader would be shown "Error de red" about a request that
   * succeeded, and the FELL_BACK warning — the one sentence stopping them from
   * editing every client's mail by mistake — would never render.
   *
   * Same split, and same reason, as the create form's live preview.
   */
  engineErrorMessage: string | null;
  /**
   * The collector as the operator asked for it.
   *
   * Kept because the response cannot answer "what did I ask for?": on a
   * fallback, `content.collector` is null — the generic — and the requested
   * collector appears nowhere in it. The warning has to name the collector that
   * was asked for, so it has to come from here.
   */
  requestedCollector: string;
  /** The exact spelling this one answer was asked in. */
  requestedAction: string;
  requestedActionType: string;
}

/** One spelling's outcome: an answer, or the reason there is none. */
export interface SpellingAnswer {
  spelling: ActionSpelling;
  result: ResolveByActionResult | null;
  error: Error | null;
}

export interface ResolveAcrossSpellingsResult {
  /** One entry per spelling asked, in the order they were passed. */
  answers: SpellingAnswer[];
  /**
   * The question this result answers, for the caller's staleness check.
   *
   * Carried not to be DISPLAYED but so the caller can tell whether this result
   * still answers the question on screen. `mutation.reset()` cannot cancel a
   * `mutationFn` already in flight, so a slow response lands on the observer no
   * matter how many times the selection changed in the meantime — and a
   * resolution read under the wrong triple is not stale, it is false. The
   * action pair is the first spelling; `resolutionMatchesSelection` compares it
   * canonically, so any stored spelling of the pair names the same question.
   */
  requestedAction: string;
  requestedActionType: string;
  requestedCollector: string;
}

async function resolveOne(
  spelling: ActionSpelling,
  collector: string,
  variant: PreviewVariant,
): Promise<ResolveByActionResult> {
  const content = await templatesApi.resolveByAction(
    spelling.action,
    spelling.actionType,
    {
      // Passed through untrimmed of nothing but whitespace: the server
      // canonicalizes the collector's case, and an empty value is dropped by
      // the client so the parameter is omitted rather than sent blank.
      collector: collector.trim() || undefined,
    },
  );

  const asked = {
    requestedCollector: collector.trim(),
    requestedAction: spelling.action.trim(),
    requestedActionType: spelling.actionType.trim(),
  };

  // Caught HERE rather than allowed to reject, so the API's answer survives a
  // dead engine. Only the rendered-mail area loses something; the banners and
  // the badges are built from `content` and go on saying what the send path
  // would actually do. A genuine API failure is untouched by this and still
  // rejects, because the await above is outside the try.
  try {
    const render = await renderDraft({
      action: content.action,
      actionType: content.actionType,
      html: content.html,
      subject: content.subject ?? undefined,
      variant,
    });
    return { content, render, engineErrorMessage: null, ...asked };
  } catch (error) {
    return {
      content,
      render: null,
      engineErrorMessage:
        error instanceof Error ? error.message : "el motor de render no pudo arrancar",
      ...asked,
    };
  }
}

export function useResolveByAction() {
  return useMutation<ResolveAcrossSpellingsResult, Error, ResolveByActionVariables>({
    mutationFn: async ({ spellings, collector, variant }) => {
      const [first] = spellings;
      const question = {
        requestedAction: first.action.trim(),
        requestedActionType: first.actionType.trim(),
        requestedCollector: collector.trim(),
      };

      // One spelling: exactly the old single call, including REJECTING on an
      // API failure, so the panel's error path is unchanged.
      if (spellings.length === 1) {
        const result = await resolveOne(first, collector, variant);
        return { answers: [{ spelling: first, result, error: null }], ...question };
      }

      // Several: every spelling is asked, and a failure stays with its own
      // spelling. A 404 for `payment` next to a real answer for `PAYMENT` is the
      // finding, not a reason to show nothing.
      const settled = await Promise.allSettled(
        spellings.map((spelling) => resolveOne(spelling, collector, variant)),
      );
      return {
        answers: settled.map((outcome, index) => ({
          spelling: spellings[index],
          result: outcome.status === "fulfilled" ? outcome.value : null,
          error:
            outcome.status === "rejected"
              ? outcome.reason instanceof Error
                ? outcome.reason
                : new Error(String(outcome.reason))
              : null,
        })),
        ...question,
      };
    },
  });
}
