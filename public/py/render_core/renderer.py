"""Renders the HTML body and subject with Jinja2.

Replaces the legacy FreeMarker theme layer. The request ``payload`` is exposed as
top-level template variables (so ``customer_name`` is reachable directly), plus
``commerce`` and ``resources_base_url`` for asset/URL resolution.
"""
import os
from datetime import datetime
from typing import Any, Dict, Optional

from jinja2 import (
    BaseLoader,
    ChainableUndefined,
    ChoiceLoader,
    Environment,
    FileSystemLoader,
    TemplateNotFound,
    select_autoescape,
)

import config
from errors import PermanentError
from messages import msg as _msg
from template_source import S3TemplateLoader
from template_resolver import resolve_template
from subjects import resolve_subject_template

_TEMPLATES_DIR = os.path.join(os.path.dirname(__file__), "templates")


def _capitalize_words(value: Any) -> str:
    """Mimics FreeMarker ``?capitalize``: upper-cases the first letter of each
    whitespace-separated word, leaving the rest of each word untouched."""
    if not value:
        return ""
    return " ".join(
        word[:1].upper() + word[1:] if word else word
        for word in str(value).split(" ")
    )


def _format_date(value: Any) -> str:
    """Formats an ISO-ish datetime string to YYYY-MM-DD (date only)."""
    if not value:
        return ""
    text = str(value)
    for fmt in ("%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d"):
        try:
            return datetime.strptime(text, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return text[:10]


def _format_datetime(value: Any) -> str:
    """Formats an ISO-ish datetime string to 'YYYY-MM-DD HH:MM' (keeps time)."""
    if not value:
        return ""
    text = str(value)
    for fmt in ("%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%dT%H:%M:%S"):
        try:
            return datetime.strptime(text, fmt).strftime("%Y-%m-%d %H:%M")
        except ValueError:
            continue
    return _format_date(value)


def _format_amount(value: Any) -> str:
    """Formats a number with comma thousands and two decimals (legacy ',##0.00')."""
    try:
        return f"{float(value):,.2f}"
    except (TypeError, ValueError):
        return "" if not value else str(value)


def _build_loader():
    """Bundled FileSystemLoader by default; a lazy S3 loader first (with the
    bundled set as fallback) when TEMPLATES_SOURCE == "s3". Templates are fetched
    from S3 on first use and cached by the Environment for the container life."""
    bundled = FileSystemLoader(_TEMPLATES_DIR)
    if config.TEMPLATES_SOURCE == "s3" and config.TEMPLATES_BUCKET:
        return ChoiceLoader([
            S3TemplateLoader(config.TEMPLATES_BUCKET, config.TEMPLATES_PREFIX),
            bundled,
        ])
    return bundled


def build_environment(loader: BaseLoader, resources_base_url: str) -> Environment:
    """Builds the Jinja environment this service renders with.

    Public so a preview harness can point the same environment at a different
    loader and asset host. Everything that changes what a template produces --
    autoescape, the undefined policy, the custom filters, ``msg`` -- is defined
    here and only here. The SendNotif preview used to carry its own copy of all
    of it, which is how it drifted out of sync with production.
    """
    env = Environment(
        loader=loader,
        autoescape=select_autoescape(["html", "html.j2", "j2"]),
        # Cache compiled templates for the container life; the S3 loader is only
        # hit on the first use of each template name.
        auto_reload=False,
        # Chainable so optional payment fields (payer.identification.number, ...)
        # render empty instead of raising when absent.
        undefined=ChainableUndefined,
    )
    env.filters["capitalize_words"] = _capitalize_words
    env.filters["format_date"] = _format_date
    env.filters["format_datetime"] = _format_datetime
    env.filters["format_amount"] = _format_amount
    env.globals["msg"] = _msg
    env.globals["resources_base_url"] = (resources_base_url or "").rstrip("/")
    return env


def _build_env() -> Environment:
    return build_environment(_build_loader(), config.RESOURCES_BASE_URL)


# One environment per warm Lambda container (S3 fetched once at cold start).
_ENV = _build_env()


def reload_environment() -> None:
    """Rebuilds the Jinja environment (re-reads config / re-fetches S3). Mainly
    for tests; a warm Lambda keeps the cached env for the container lifetime."""
    global _ENV
    _ENV = _build_env()


def _resolve_commerce(payload: Dict[str, Any], commerce: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """Ensures ``commerce.name`` is present. Since this service does not fetch the
    Collector (unlike the legacy API), fall back to the payment's collector_detail."""
    resolved = dict(commerce or {})
    if not resolved.get("name"):
        payments = (payload or {}).get("payments") or []
        if payments and isinstance(payments[0], dict):
            detail = payments[0].get("collector_detail") or {}
            if detail.get("name"):
                resolved["name"] = detail["name"]
    return resolved


# Payer reference label by collector type (legacy payer-information-setting.ftl).
# Jinja includes are scope-isolated, so we compute these labels in Python instead
# of relying on an <#assign>-only partial leaking into the caller.
_EXTERNAL_REF_LABELS = {
    "CLUB": "Nro de Socio",
    "ONG": "Nro de Oferente",
    "EMPRESA": "Nro de Cliente",
    "EDUCATIVA": "Nro de Alumno",
    "GOBIERNO": "Identificador de la tasa",
    "CONSORCIO": "Nro de unidad funcional",
}
_DEFAULT_EXTERNAL_REF_LABEL = "Nro de Pagador"
_DEFAULT_IDENTIFICATION_LABEL = "DNI/CUIT"


def build_context(
    payload: Dict[str, Any],
    commerce: Optional[Dict[str, Any]],
    extras: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Builds the template context: the payload spread at the top level, plus
    ``commerce``, ``payload`` itself and the reference labels.

    Public alongside ``build_environment`` so the preview harness renders against
    the same context production does instead of reimplementing it.
    """
    ctx: Dict[str, Any] = dict(payload or {})
    ctx.update(extras or {})  # top-level fields (e.g. signature)
    resolved_commerce = _resolve_commerce(payload, commerce)
    ctx["commerce"] = resolved_commerce
    ctx["payload"] = payload or {}
    ctx["labelExternalReference"] = _EXTERNAL_REF_LABELS.get(
        resolved_commerce.get("type"), _DEFAULT_EXTERNAL_REF_LABEL
    )
    ctx["labelIdentificationNumber"] = _DEFAULT_IDENTIFICATION_LABEL
    return ctx


def render_body(
    action: str,
    payload: Dict[str, Any],
    commerce: Optional[Dict[str, Any]] = None,
    extras: Optional[Dict[str, Any]] = None,
) -> str:
    """Renders the HTML email body for an action."""
    template_name = resolve_template(action)
    try:
        template = _ENV.get_template(template_name)
    except TemplateNotFound as exc:
        raise PermanentError(
            f"template file '{template_name}' not found for action '{action}'",
            code="TEMPLATE_NOT_FOUND",
        ) from exc
    return template.render(**build_context(payload, commerce, extras))


def render_subject(
    action: str,
    payload: Dict[str, Any],
    commerce: Optional[Dict[str, Any]] = None,
    extras: Optional[Dict[str, Any]] = None,
) -> str:
    """Renders the subject line, resolving precedence then interpolating."""
    raw = resolve_subject_template(action, payload)
    return _ENV.from_string(raw).render(**build_context(payload, commerce, extras)).strip()
