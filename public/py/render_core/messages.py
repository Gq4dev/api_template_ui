"""i18n message catalog (Spanish), ported from the legacy theme
``messages_es.properties`` files. Exposes ``msg(key)`` for use inside templates.

Body templates call ``msg('key')`` for a few shared strings; unknown keys render
empty (legacy FreeMarker would echo the key, but empty is cleaner for email).
Subject strings live in ``subjects.py``.
"""
from typing import Any

# Non-subject message keys used by template bodies (common/error + misc).
_MESSAGES = {
    "errorTitle": "Error",
    "errorHeader": "Oops!",
    "errorMessage": "Se produjo un error al mostrar esta página web",
    "error404Header": "Error página no encontrada",
    "error404Message": "El servidor no ha encontrado la página o recurso que se le ha solicitado",
}


def msg(key: Any, *_args: Any) -> str:
    """Returns the Spanish message for a key, or empty string if unknown."""
    return _MESSAGES.get(str(key), "")
