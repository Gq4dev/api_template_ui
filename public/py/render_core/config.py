"""Runtime configuration read from environment variables.

Email delivery goes over SMTP to the corporate Postfix relay, which holds the SES
authentication, rules and daily quota and forwards to SES. This service only
needs the relay host/port (and credentials in environments that require auth).
"""
import logging
import os
from email.utils import parseaddr

# Optional: load a local ".env" for development. python-dotenv is a dev-only
# dependency -- in Lambda it is absent and the variables come from the function
# configuration, so this is a silent no-op there.
try:
    from dotenv import load_dotenv

    load_dotenv()
except ImportError:
    pass

# Configure logging as early as possible (config is the first import everywhere),
# so INFO logs emitted during module import (e.g. S3 template loading) are visible.
logging.getLogger().setLevel(logging.INFO)

# Sender identity used in the From header. Format: "Name <addr>" or "addr".
# The relay authenticates against SES, so this address must be one SES accepts.
SES_SENDER = os.environ.get("SES_SENDER", "Pago TIC <no-reply@pagotic.com>")

# AWS region for the SQS client (DLQ). SES is reached through the relay, not the
# AWS SDK, so this no longer points at an SES identity region.
SES_REGION = os.environ.get("SES_REGION") or os.environ.get("AWS_REGION", "us-east-1")

# --- SMTP relay (Postfix) ---
# The relay does the SES auth and forwarding. In dev (awsdev-smtp.pptic.dev) it
# listens on port 25, no auth, and only delivers to @pagotic.com. Prod may require
# credentials and STARTTLS, so both are env-driven.
SMTP_HOST = os.environ.get("SMTP_HOST", "awsdev-smtp.pptic.dev")
SMTP_PORT = int(os.environ.get("SMTP_PORT", "25"))
SMTP_USER = os.environ.get("SMTP_USER") or None
SMTP_PASSWORD = os.environ.get("SMTP_PASSWORD") or None
SMTP_USE_TLS = (os.environ.get("SMTP_USE_TLS", "false").strip().lower()
                in ("1", "true", "yes"))
SMTP_TIMEOUT = int(os.environ.get("SMTP_TIMEOUT", "10"))


def smtp_from_addr() -> str:
    """Bare envelope sender (``addr`` without the display name) for MAIL FROM."""
    return parseaddr(SES_SENDER)[1] or SES_SENDER

# Base URL that hosts the theme assets (images) referenced by the templates.
# Mirrors the legacy `com.paypertic.notifications.resources.url`.
RESOURCES_BASE_URL = os.environ.get(
    "RESOURCES_BASE_URL", "https://api.paypertic.com/notificaciones"
).rstrip("/")

# Every notification is always blind-copied here (legacy behaviour).
FIXED_BCC = os.environ.get("FIXED_BCC", "cobrar@pagotic.com")

# Dead-letter queue URL. When set, notifications that hit a permanent error
# (missing required field, unknown action, missing template, unparseable body,
# relay rejection) are sent straight here for manual review instead of being
# silently dropped. When unset, the layer is a no-op and such messages are
# dropped as before.
DLQ_URL = os.environ.get("DLQ_URL") or None

# Charset for the rendered HTML body and subject.
CHARSET = "UTF-8"

# --- Template source ---
# "bundled" -> templates shipped in the Lambda zip (default, zero-latency).
# "s3"      -> templates loaded from S3 at cold start, cached for the container
#              lifetime, with the bundled set as a fallback.
TEMPLATES_SOURCE = (os.environ.get("TEMPLATES_SOURCE") or "bundled").strip().lower()

# S3 bucket holding the templates (used only when TEMPLATES_SOURCE == "s3").
TEMPLATES_BUCKET = os.environ.get("TEMPLATES_BUCKET") or None

# Key prefix under which templates live in the bucket. Stripped to build the
# Jinja template name (e.g. "templates/partials/header.html.j2" -> "partials/header.html.j2").
_raw_prefix = os.environ.get("TEMPLATES_PREFIX", "templates/")
TEMPLATES_PREFIX = (_raw_prefix.rstrip("/") + "/") if _raw_prefix else "templates/"

# --- MongoDB persistence (optional) ---
# When MONGODB_URI is set, every send attempt is recorded in MongoDB:
#   - the "current" collection keeps one upserted document per notification id
#     (latest status + full JSON + last-modified timestamp)
#   - the "history" collection appends one document per status transition
# When unset, persistence is a no-op and the service behaves exactly as before.
# The URI is expected to already carry the credentials (injected from the .env /
# terraform secret), e.g. "mongodb+srv://user:pass@api.ro8hhr9.mongodb.net/?appName=api".
MONGODB_URI = os.environ.get("MONGODB_URI") or None
MONGODB_DB = os.environ.get("MONGODB_DB", "notifications")
MONGODB_CURRENT = os.environ.get("MONGODB_CURRENT_COLLECTION", "sent")
MONGODB_HISTORY = os.environ.get("MONGODB_HISTORY_COLLECTION", "history")
MONGODB_APP_NAME = os.environ.get("MONGODB_APP_NAME", "notifications-sender")
# Fail fast on a dead cluster so a Mongo outage can't eat the Lambda timeout.
MONGODB_TIMEOUT_MS = int(os.environ.get("MONGODB_TIMEOUT_MS", "3000"))
