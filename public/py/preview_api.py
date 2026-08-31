"""The API the browser worker calls. Everything crossing the JS boundary is JSON.

This module is deliberately thin. It does not decide how to render — it asks
``renderer.build_environment`` and ``renderer.build_context``, the same two
functions the Lambda uses, and only swaps the loader so the author's draft is
reachable by name. Every behaviour that changes output (autoescape, the
undefined policy, the four custom filters, the ``msg`` global) therefore comes
from production code, not from a reimplementation here.

Errors are RETURNED, never raised across the boundary: a draft that does not
parse is the normal case while someone is typing, not an exception.
"""
import json
import traceback

from jinja2 import (
    ChoiceLoader,
    DictLoader,
    FileSystemLoader,
    TemplateNotFound,
    TemplateSyntaxError,
)

import renderer
import shape_extractor
from errors import SenderError
from subjects import resolve_subject_template
from template_resolver import resolve_template

# Where the worker mounts the vendored copy in Pyodide's virtual filesystem.
# `configure()` overrides it — the worker states its mount point explicitly
# rather than relying on this default matching.
TEMPLATES_DIR = "/render_core/templates"

# The synthetic name the draft is compiled under. The leading underscores keep
# it from colliding with a real action's template.
DRAFT_NAME = "__draft__.html.j2"

# Matches config.RESOURCES_BASE_URL. Passed explicitly rather than read from the
# environment because Pyodide has no environment to read.
RESOURCES_BASE_URL = "https://api.paypertic.com/notificaciones"

_bundled = FileSystemLoader(TEMPLATES_DIR)


def configure(templates_dir):
    """Points the bundled loader at `templates_dir`. Call once, before use."""
    global TEMPLATES_DIR, _bundled
    TEMPLATES_DIR = templates_dir
    _bundled = FileSystemLoader(templates_dir)


def _env_for(draft_html=None):
    """The production environment, with the draft reachable as DRAFT_NAME."""
    loader = _bundled
    if draft_html is not None:
        loader = ChoiceLoader([DictLoader({DRAFT_NAME: draft_html}), _bundled])
    return renderer.build_environment(loader, RESOURCES_BASE_URL)


def _bundled_source(name):
    """Reads a bundled template, or None. Feeds extends/include resolution."""
    try:
        return _bundled.get_source(_env_for(), name)[0]
    except TemplateNotFound:
        return None


def compose_action(action, action_type):
    """Builds the sender's dotted action from the two fields the UI collects.

    The API models a template as (action, actionType); the sender models it as
    one dotted lowercase string. "payment" + "approved" -> "payment.approved",
    which is what resolve_template validates and maps to a file.
    """
    parts = [str(part or "").strip().lower() for part in (action, action_type)]
    return ".".join(part for part in parts if part)


def _list_size(variant):
    return 2 if variant == "multi" else 1


def _shape_for_action(dotted_action):
    """The variable shape the action's PRODUCTION template expects.

    This is what replaced ``GET /contract``: it answers "what does this
    notification provide" before the author has typed anything, which parsing
    the draft can never do — the variable someone has not used yet is exactly
    the one worth showing them.

    Returns (shape, template_name, problem). `problem` is None when resolved.
    """
    try:
        template_name = resolve_template(dotted_action)
    except SenderError as exc:
        return {}, None, {
            "kind": "INVALID_ACTION",
            "message": str(exc),
            "code": getattr(exc, "code", None),
        }

    source = _bundled_source(template_name)
    if source is None:
        return {}, template_name, {
            "kind": "TEMPLATE_NOT_FOUND",
            "message": (
                f"the sender has no bundled template named '{template_name}' for "
                f"action '{dotted_action}'"
            ),
            "code": "TEMPLATE_NOT_FOUND",
        }

    try:
        analysis = shape_extractor.analyze(source, get_source=_bundled_source)
    except TemplateSyntaxError as exc:
        return {}, template_name, {
            "kind": "SYNTAX",
            "message": f"the bundled template does not parse: {exc.message}",
            "line": exc.lineno,
        }
    return analysis["shape"], template_name, None


def catalogue(action, action_type, variant="single"):
    """The variable catalogue for an action, as JSON."""
    dotted = compose_action(action, action_type)
    shape, template_name, problem = _shape_for_action(dotted)
    return json.dumps({
        "action": dotted,
        "variant": variant,
        "template": template_name,
        "known": problem is None,
        "problem": problem,
        "variables": sorted(shape.keys()),
        "context": shape_extractor.build_sample(shape, _list_size(variant)),
    })


def render_draft(action, action_type, html, subject=None, variant="single"):
    """Renders a draft the way the sender would, with generated sample data.

    The sample merges the action's production shape with whatever the draft
    itself references, so a variable the author invented still gets a value
    instead of rendering empty and reading like missing data.
    """
    dotted = compose_action(action, action_type)
    env = _env_for(html)

    try:
        analysis = shape_extractor.analyze(
            html,
            get_source=_bundled_source,
            known_filters=env.filters.keys(),
            list_size=_list_size(variant),
        )
    except TemplateSyntaxError as exc:
        # The cheapest gate there is, and the one worth showing verbatim: it
        # carries the line number the author needs.
        return json.dumps({
            "ok": False,
            "kind": "SYNTAX",
            "message": exc.message,
            "line": exc.lineno,
        })

    action_shape, template_name, problem = _shape_for_action(dotted)
    merged = shape_extractor.merge_shapes(action_shape, analysis["shape"])
    sample = shape_extractor.build_sample(merged, _list_size(variant))

    context = renderer.build_context(sample, {"name": "Comercio de ejemplo"}, {})

    try:
        rendered_html = env.get_template(DRAFT_NAME).render(**context)
    except TemplateNotFound as exc:
        # Almost always a typo in "{% extends %}" — name the missing file.
        return json.dumps({
            "ok": False,
            "kind": "TEMPLATE_NOT_FOUND",
            "message": f"the draft references a template that does not exist: {exc.name}",
        })
    except Exception as exc:  # noqa: BLE001 - any render failure is the author's to see
        return json.dumps({
            "ok": False,
            "kind": "RENDER",
            "message": f"{type(exc).__name__}: {exc}",
            "traceback": traceback.format_exc(limit=3),
        })

    rendered_subject, subject_problem = _render_subject(env, context, dotted, subject)

    return json.dumps({
        "ok": True,
        "action": dotted,
        "variant": variant,
        "html": rendered_html,
        "subject": rendered_subject,
        "subjectProblem": subject_problem,
        "variables": sorted(merged.keys()),
        "sample": sample,
        # Cannot happen while the environment is production's, but if the sender
        # ever adds a filter and the sync is stale, this is how it surfaces
        # instead of a blank render.
        "unknownFilters": analysis["unknown_filters"],
        # Present when the action itself is unknown: the draft still renders, the
        # UI just cannot claim the variable list is authoritative.
        "actionProblem": problem,
        "template": template_name,
    })


def _render_subject(env, context, dotted_action, subject):
    """The author's subject when given, otherwise the sender's own for the action."""
    raw = subject
    if raw is None or str(raw).strip() == "":
        try:
            raw = resolve_subject_template(dotted_action, context)
        except SenderError:
            return None, None
        except Exception:  # noqa: BLE001
            return None, None
    try:
        return env.from_string(str(raw)).render(**context).strip(), None
    except TemplateSyntaxError as exc:
        # The body may be perfectly fine; failing the whole preview over the
        # subject line would hide that.
        return None, {"kind": "SYNTAX", "message": exc.message, "line": exc.lineno}
    except Exception as exc:  # noqa: BLE001
        return None, {"kind": "RENDER", "message": f"{type(exc).__name__}: {exc}"}


def runtime_info():
    """Versions and filter inventory, so the UI can flag a stale sync."""
    import jinja2

    env = _env_for()
    return json.dumps({
        "jinja2": jinja2.__version__,
        "filters": sorted(env.filters.keys()),
        "customFilters": sorted(
            name
            for name in ("capitalize_words", "format_date", "format_datetime", "format_amount")
            if name in env.filters
        ),
        "undefined": env.undefined.__name__,
        "autoescape": bool(env.autoescape),
    })
