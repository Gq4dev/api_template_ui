"""Error taxonomy that drives the retry decision.

- PermanentError: the message will never succeed (bad payload, unknown action,
  missing template). Retrying is pointless, so the handler logs it and lets SQS
  delete the message instead of cycling it through retry -> DLQ.
- TransientError: a temporary failure (relay connectivity/timeout, 4xx SMTP). The
  handler re-raises so SQS redelivers it: main queue -> retry queue -> DLQ.

Both kinds carry a ``code`` so the reason is queryable in the persisted
``failure`` document instead of only readable in the free-text detail. The code
says *why* it failed; the persisted ``status`` says *what happens next*
(``failed`` = parked in the DLQ, ``retrying`` = SQS will redeliver). They are
independent: a coded transient error is still retried, so do not read a code as
"permanent".

The codes are raised across several modules, so the taxonomy is listed here.

Permanent:

- ``NOT_AN_OBJECT``        the notification is not a JSON object (handler)
- ``UNPARSEABLE_BODY``     the SQS body is not valid JSON at all (handler)
- ``MISSING_FIELDS``       required fields absent or empty; ``fields`` lists them
                           (handler, template_resolver, mailer)
- ``INVALID_ACTION``       the action is not a well-formed action name, so no
                           filename can be derived from it (template_resolver)
- ``TEMPLATE_NOT_FOUND``   no template file exists for the action -- either the
                           action is not supported yet or its template was never
                           uploaded (renderer)
- ``RELAY_ADDRESS_REFUSED``the relay refused the sender or a recipient (mailer)
- ``RELAY_REJECTED``       the relay answered 5xx (mailer)

Transient:

- ``RELAY_TRANSIENT``      the relay answered 4xx (busy/greylisting) (mailer)
- ``RELAY_UNAVAILABLE``    connect/DNS/timeout against the relay (mailer)

Handler fallbacks. Seeing one of these in Mongo means a raise site was missed --
give it a code here rather than letting the reason collapse into a generic
bucket:

- ``PERMANENT_ERROR``      a ``PermanentError`` raised without a code
- ``TRANSIENT_ERROR``      a ``TransientError`` raised without a code
- ``UNEXPECTED_ERROR``     not a ``SenderError`` at all; the offending exception
                           class is stored alongside it
"""


from typing import Optional, Sequence


class SenderError(Exception):
    """Base class for sender errors.

    Optionally carries a machine-readable ``code`` and the list of ``fields``
    that caused the failure. The persistence layer stores these as a structured
    ``failure`` reason (queryable in Mongo) next to the human-readable message.
    Both subclasses need this: knowing *why* a message is being retried is as
    useful as knowing why one was dropped.
    """

    def __init__(
        self,
        message: str,
        *,
        code: Optional[str] = None,
        fields: Optional[Sequence[str]] = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.fields = list(fields) if fields else []


class PermanentError(SenderError):
    """Non-retryable: dropping the message is the correct outcome."""


class TransientError(SenderError):
    """Retryable: let SQS redrive handle another attempt."""
