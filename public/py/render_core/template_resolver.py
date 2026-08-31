"""Maps a notification ``action`` to a Jinja2 template file.

The filename is derived from the action by convention: dots become underscores
and ``.html.j2`` is appended, so ``payment.approved`` resolves to
``payment_approved.html.j2``. Supporting a new action therefore only means
uploading its template to the bucket -- no code change, no redeploy.

This replaces a hand-written 50-entry map. Forty-two of those entries already
followed the convention; the map's only remaining job is the handful of actions
whose template predates it (``LEGACY_ALIASES``). Keeping the map was also a
correctness risk in itself: it drifted from disk and left
``cvu.transaction.authorized`` pointing at a file that does not exist, dead-
lettering every one of those notifications. A derived name cannot drift.

The action is validated against a charset before it becomes a filename. That
preserves the old map's useful side effect -- a malformed action fails here,
with a precise code, instead of costing a bucket round trip -- and means a
producer can never steer the lookup outside the template prefix.
"""
import re

from errors import PermanentError

# Actions whose template does not follow the convention.
#
# FROZEN -- do not add entries. A new action gets a file named after it; that is
# the whole point of the convention. These survive because each name is either a
# genuine alias (two actions, one template) or better than the name the
# convention would impose.
LEGACY_ALIASES = {
    # Alias: both actions render the same "payment approved" mail.
    "payment.payment": "payment_approved.html.j2",
    # The domain calls these billing periods; the action names do not.
    "opening.period": "billing_period_open.html.j2",
    "closing.period": "billing_period_closed.html.j2",
    # The "third_party_payment_" prefix groups these four; the actions do not.
    "pending.authorization": "third_party_payment_pending.html.j2",
    "transfer.success.authorizer": "third_party_payment_success.html.j2",
    "transfer.success.beneficiary": "third_party_payment_success_beneficiary.html.j2",
    "transfer.error": "third_party_payment_error.html.j2",
}

# Dot-separated lowercase segments, e.g. "payment.remember_without_payment_method".
# Anything else is a malformed action (a producer bug), not an unsupported one.
_ACTION_RE = re.compile(r"^[a-z0-9]+(?:_[a-z0-9]+)*(?:\.[a-z0-9]+(?:_[a-z0-9]+)*)*$")

TEMPLATE_SUFFIX = ".html.j2"


def conventional_template(action: str) -> str:
    """The template filename an action maps to by convention."""
    return action.replace(".", "_") + TEMPLATE_SUFFIX


def resolve_template(action: str) -> str:
    """Returns the template filename for an action.

    Raises ``PermanentError`` when the action is absent or malformed. A
    well-formed action with no template resolves to a name that does not exist;
    the renderer reports that as ``TEMPLATE_NOT_FOUND``, so "no template yet"
    and "not a valid action" stay distinguishable in the persisted failure.
    """
    if not action:
        raise PermanentError(
            "notification is missing 'action'",
            code="MISSING_FIELDS",
            fields=["action"],
        )
    # isinstance first: the action comes from producer JSON, so it may not be a
    # string at all, and a regex match against a non-string raises TypeError --
    # which the handler would read as an unexpected error and retry forever.
    if not isinstance(action, str) or not _ACTION_RE.match(action):
        raise PermanentError(
            f"action '{action}' is not a valid action name "
            "(expected dot-separated lowercase segments)",
            code="INVALID_ACTION",
        )
    return LEGACY_ALIASES.get(action) or conventional_template(action)
