"""Resolves the email subject for an action.

Ported from the legacy ``messages_es.properties`` subject catalog + the ``Action``
enum default subjects. Precedence (mirrors the Java SMTP service):

1. ``payload.subject`` if the producer set one -> wins.
2. the ``<action>.subject`` entry in SUBJECT_MESSAGES.
3. the action's default subject in DEFAULT_SUBJECTS.
4. a generic fallback.

The resulting string is rendered through Jinja2, so subjects like
``{{ commerce.name }} - Pago Exitoso`` interpolate.
"""
from typing import Any, Dict, Optional

# Subjects from messages_es.properties (FreeMarker ${x} -> Jinja {{ x }}).
SUBJECT_MESSAGES: Dict[str, str] = {
    # payment
    "payment.approved": "{{ commerce.name }} - Pago Exitoso",
    "payment.payment": "{{ commerce.name }} - Pago Exitoso",
    "payment.rejected": "{{ commerce.name }} - Pago Rechazado",
    "payment.cancel": "{{ commerce.name }} - Pago Cancelado",
    "payment.deferred": "{{ commerce.name }} - Pago Diferido",
    "payment.objected": "{{ commerce.name }} - Pago Objetado",
    "payment.cancel_objected": "{{ commerce.name }} - Objeción Cancelada",
    "payment.remember": "{{ commerce.name }} - Pago Emitido",
    "payment.remember_without_payment_method": "{{ commerce.name }} - Pago Pendiente",
    "payment.share": "{{ commerce.name }} - Te compartieron un pago",
    "payment.refunded": "{{ commerce.name }} - Pago reembolsado",
    "payment.change": "{{ commerce.name }} - Pago actualizado",
    # subscription
    "subscription.review": "{{ commerce.name }} - Suscripción pendiente de aprobación",
    "subscription.pause": "{{ commerce.name }} - Suscripción pausada",
    "subscription.subscribe": "{{ commerce.name }} - Suscripción Aprobada",
    "subscription.rejected": "{{ commerce.name }} - Suscripción Rechazada",
    "subscription.cancel": "{{ commerce.name }} - Suscripción Cancelada",
    "subscription.retry": "{{ commerce.name }} - Reintentá tu suscripción",
    "subscription.change": "{{ commerce.name }} - Cambios en tu suscripción",
    "subscription.finished": "{{ commerce.name }} - Suscripción finalizada",
    "subscription.validate": "{{ commerce.name }} - Confirma tu suscripción",
    # management / notification
    "management.collector_register_welcome": "¡Bienvenidos a Pay per TIC!",
    "management.collector_register": "Alta de entidad {{ signature }}",
    "notification.notification": "{{ commerce.name }} - Información Importante",
    "notification.invite": "{{ commerce.name }} - Invitación",
}

# Default subjects (legacy Action enum) for actions with no messages key.
DEFAULT_SUBJECTS: Dict[str, str] = {
    "subscription.pending": "Actualizá tu adhesión y asegurá tus pagos",
    "subscription.howto.cancel": "¿Cómo cancelar tu suscripción?",
    "payment.reverse": "Reversión de pago",
    "payment.service.approved": "{{ commerce.name }} - Pago Exitoso",
    "download.voucher": "Tu comprobante de pago",
}

_GENERIC_SUBJECT = "Notificación de Pago TIC"


def resolve_subject_template(action: str, payload: Optional[Dict[str, Any]]) -> str:
    """Returns the raw (pre-render) subject string for an action."""
    payload = payload or {}
    payload_subject = payload.get("subject")
    if payload_subject:
        return str(payload_subject)
    return (
        SUBJECT_MESSAGES.get(action)
        or DEFAULT_SUBJECTS.get(action)
        or _GENERIC_SUBJECT
    )
