"""Derives the variable shape an author's template expects, from its Jinja2 AST.

This is what replaced ``GET /api/v1/templates/contract`` when the API stopped
deriving anything. It has two callers and one implementation:

* offline, over the templates bundled in the sender repo, to build the per-action
  variable catalogue the UI ships;
* live, over the draft the author is typing, to offer a sample payload for a
  template nothing has fixtures for.

``jinja2.meta.find_undeclared_variables`` is not enough for either: given
``{{ payer.identification.number }}`` it returns ``payer`` and stops. An author
needs the nested shape, so this walks ``Getattr`` / ``Getitem`` / ``For`` and
rebuilds it.

Accuracy notes, each of which cost a real template to discover:

1. ``{% set %}`` is a statement. Its binding applies to the statements that
   FOLLOW it — its siblings, not its children. A scope that only travels
   downwards reports ``p``, ``single`` and ``commerce_name`` as if the author
   had to supply them.
2. ``{% for d in (p.details or []) %}`` is the common defensive idiom. Without
   resolving ``Or`` to its left operand the iterable is unknown and the whole
   loop body is lost.
3. A name can be a leaf and a container at once (``payments`` mentioned bare,
   plus ``payments[0].amount``). The container wins: it carries more information.
"""
from collections import OrderedDict

from jinja2 import Environment, nodes

# Supplied by renderer.build_environment / renderer.build_context, not by the
# author. Reporting these would send someone hunting for a value the sender
# already injects.
INJECTED = frozenset({
    "msg",
    "resources_base_url",
    "commerce",
    "payload",
    "labelExternalReference",
    "labelIdentificationNumber",
    "signature",
})

# Jinja's own names, never part of a payload.
BUILTINS = frozenset({
    "loop", "range", "dict", "lipsum", "cycler", "joiner", "namespace",
    "true", "false", "none",
})

# Marks a list hop inside a path tuple: ('payments', LIST, 'amount').
LIST = "[]"

# Filter -> leaf type. The four custom ones come from renderer.build_environment;
# the rest are builtins that still pin down a shape.
FILTER_TYPES = {
    "format_amount": "number",
    "format_date": "date",
    "format_datetime": "datetime",
    "capitalize_words": "string",
    "int": "number",
    "float": "number",
    "round": "number",
    "length": "list",
    "join": "list",
    "sum": "list",
    "first": "list",
    "last": "list",
}


class _ShapeCollector:
    """Walks one template (and everything it extends/includes) collecting paths."""

    def __init__(self, get_source):
        self._get_source = get_source
        self._env = Environment()          # parse-only; never renders
        self.paths = {}                    # tuple -> type hint or None
        self.filters = set()               # every filter name seen
        self.visited = set()

    # -- expression -> path ---------------------------------------------
    def resolve(self, node, scope):
        """The dotted path a expression refers to, or None when it is not a
        variable reference (a literal, a call, a comparison...)."""
        if isinstance(node, nodes.Name):
            if node.name in scope:
                return scope[node.name]    # None means local/shadowed
            if node.name in BUILTINS:
                return None
            return (node.name,)
        if isinstance(node, nodes.Getattr):
            base = self.resolve(node.node, scope)
            return base + (node.attr,) if base else None
        if isinstance(node, nodes.Getitem):
            base = self.resolve(node.node, scope)
            if not base:
                return None
            if isinstance(node.arg, nodes.Const) and isinstance(node.arg.value, str):
                return base + (node.arg.value,)
            return base + (LIST,)          # numeric or dynamic index -> a list
        if isinstance(node, nodes.Or):
            # Gotcha 2: "x or []" / "x or ''". The shape is the left side.
            return self.resolve(node.left, scope)
        if isinstance(node, nodes.Filter) and node.node is not None:
            # "{% for d in items|default([]) %}" — the shape is still `items`.
            return self.resolve(node.node, scope)
        return None

    def record(self, path, hint=None):
        if not path or path[0] in BUILTINS:
            return
        self.paths[path] = hint or self.paths.get(path)

    # -- traversal -------------------------------------------------------
    def walk_sequence(self, items, scope):
        """Walks sibling statements carrying the scope sideways (gotcha 1)."""
        scope = dict(scope)
        for item in items:
            if isinstance(item, nodes.Assign):
                self.walk(item.node, scope)
                if isinstance(item.target, nodes.Name):
                    scope[item.target.name] = self.resolve(item.node, scope)
                continue
            self.walk(item, scope)

    def walk_children(self, node, scope):
        self.walk_sequence(list(node.iter_child_nodes()), scope)

    def walk(self, node, scope):
        if isinstance(node, nodes.For):
            source = self.resolve(node.iter, scope)
            if source:
                self.record(source, "list")
            self.walk(node.iter, scope)
            inner = dict(scope)
            item = source + (LIST,) if source else None
            target = node.target
            if isinstance(target, nodes.Name):
                inner[target.name] = item
            elif isinstance(target, nodes.Tuple):
                # "{% for k, v in mapping.items() %}" — shape is unknowable.
                for sub in target.items:
                    if isinstance(sub, nodes.Name):
                        inner[sub.name] = None
            self.walk_sequence(node.body, inner)
            self.walk_sequence(node.else_, inner)
            return

        if isinstance(node, nodes.With):
            for value in node.values:
                self.walk(value, scope)
            inner = dict(scope)
            for target in node.targets:
                if isinstance(target, nodes.Name):
                    inner[target.name] = None
            self.walk_sequence(node.body, inner)
            return

        if isinstance(node, nodes.Macro):
            inner = dict(scope)
            for arg in node.args:
                if isinstance(arg, nodes.Name):
                    inner[arg.name] = None
            self.walk_sequence(node.body, inner)
            return

        if isinstance(node, nodes.Filter):
            self.filters.add(node.name)
            if node.node is not None:
                path = self.resolve(node.node, scope)
                if path:
                    self.record(path, FILTER_TYPES.get(node.name, "string"))
            self.walk_children(node, scope)
            return

        if isinstance(node, (nodes.Extends, nodes.Include)):
            template = node.template
            if isinstance(template, nodes.Const) and isinstance(template.value, str):
                self.collect(template.value)
            return

        # A variable reference. Recording it stops the descent on purpose: the
        # children are the chain that produced this very path.
        if isinstance(node, (nodes.Name, nodes.Getattr, nodes.Getitem)):
            path = self.resolve(node, scope)
            if path:
                self.record(path)
                return

        self.walk_children(node, scope)

    def collect(self, name):
        """Follows a template by name, once."""
        if name in self.visited:
            return
        self.visited.add(name)
        source = self._get_source(name) if self._get_source else None
        if source is None:
            return                          # unresolvable parent: report nothing
        self.walk(self._env.parse(source, name=name), {})

    def collect_source(self, source, name="<draft>"):
        self.visited.add(name)
        self.walk(self._env.parse(source, name=name), {})


# -- shape assembly ------------------------------------------------------
def _assemble(paths):
    """Turns {('payer','identification','number'): None} into nested dicts.

    A list hop becomes {"__list__": {...}} so the caller can tell "one object"
    from "many" without a parallel type map.
    """
    root = OrderedDict()
    for path, hint in sorted(paths.items()):
        if path[0] in INJECTED:
            continue
        node = root
        for index, part in enumerate(path):
            if part == LIST:
                continue
            last = index == len(path) - 1
            following = path[index + 1] if not last else None
            current = node.get(part)

            if last:
                # Gotcha 3: an existing container outranks a bare mention.
                if not isinstance(current, dict):
                    node[part] = hint or "string"
                continue

            if following == LIST:
                if not (isinstance(current, dict) and "__list__" in current):
                    node[part] = {"__list__": OrderedDict()}
                node = node[part]["__list__"]
            elif isinstance(current, dict) and "__list__" in current:
                node = current["__list__"]  # mixed scalar/list use
            else:
                if not isinstance(current, dict):
                    node[part] = OrderedDict()
                node = node[part]
    return root


# Leaf name -> placeholder. Ordered: the first substring match wins, so the
# specific entries have to come before the generic ones ("identification"
# before "id", "beneficiary_email" before "name").
_PLACEHOLDERS = (
    (("email", "mail"), "usuario@ejemplo.com"),
    (("cuit", "cuil", "identification", "dni"), "20123456789"),
    (("amount", "importe", "total", "price", "monto"), 1234.56),
    (("date", "fecha", "expiration", "vencimiento"), "2026-07-30T12:00:00"),
    (("url", "link", "href", "logo", "img"), "https://ejemplo.com/recurso"),
    (("alias",), "mi.alias.pagotic"),
    (("cvu", "cbu"), "0000031000000000000000"),
    (("name", "nombre"), "Juan Perez"),
    (("phone", "telefono"), "+54 11 5555-5555"),
    (("id", "number", "numero", "reference"), "123456"),
)


def _sample_leaf(key, hint):
    if hint == "number":
        return 1234.56
    if hint in ("date", "datetime"):
        return "2026-07-30T12:00:00"
    lowered = key.lower()
    for needles, value in _PLACEHOLDERS:
        if any(needle in lowered for needle in needles):
            return value
    # Square brackets, not angle ones: this value is interpolated into HTML, and
    # "<name>" would either be escaped into noise or — inside an attribute, or
    # behind |safe — break the markup it lands in.
    return f"[{key}]"


def build_sample(shape, list_size=1):
    """A payload matching `shape`.

    `list_size` drives the single/multi preview toggle: several templates branch
    on `(payments | length) <= 1` and lay the mail out differently, so an author
    has to be able to see both. The elements are identical on purpose — the
    question the multi preview answers is whether the loop and the table render,
    not whether two different payments look different.
    """
    sample = OrderedDict()
    for key, value in shape.items():
        if isinstance(value, dict) and "__list__" in value:
            element = build_sample(value["__list__"], list_size)
            sample[key] = [element for _ in range(max(1, list_size))]
        elif isinstance(value, dict):
            sample[key] = build_sample(value, list_size)
        else:
            sample[key] = _sample_leaf(key, value)
    return sample


def merge_shapes(base, extra):
    """Deep-merges two shapes, preferring containers over bare leaves.

    Used to combine what the action's production template provides with what the
    author's draft actually references, so a variable someone invented still gets
    a sample instead of rendering empty and looking like a data problem.
    """
    merged = OrderedDict(base)
    for key, value in extra.items():
        current = merged.get(key)
        if isinstance(current, dict) and isinstance(value, dict):
            if "__list__" in current and "__list__" in value:
                merged[key] = {
                    "__list__": merge_shapes(current["__list__"], value["__list__"])
                }
            elif "__list__" in current or "__list__" in value:
                # One side says list, the other says object. The list wins: it is
                # the shape the template iterates, and rendering it as an object
                # would break the loop.
                listy = current if "__list__" in current else value
                other = value if "__list__" in current else current
                merged[key] = {"__list__": merge_shapes(listy["__list__"], other)}
            else:
                merged[key] = merge_shapes(current, value)
        elif isinstance(current, dict):
            merged[key] = current            # container outranks a bare leaf
        else:
            merged[key] = value
    return merged


def analyze(source, get_source=None, known_filters=None, list_size=1):
    """Analyzes one template body.

    `get_source(name) -> str | None` resolves `{% extends %}` / `{% include %}`;
    returning None for an unknown name degrades gracefully instead of raising,
    because a draft may reference a layout mid-typo.

    `known_filters` is the filter set of the environment that will render — pass
    `env.filters.keys()` so a template using a filter production does not have
    is reported instead of failing silently at send time.

    Returns {shape, sample, variables, filters, unknown_filters}. Raises
    jinja2.TemplateSyntaxError when the body does not parse — that is the
    cheapest gate there is, and the caller should surface it verbatim.
    """
    collector = _ShapeCollector(get_source)
    collector.collect_source(source)

    shape = _assemble(collector.paths)
    unknown = (
        sorted(collector.filters - set(known_filters)) if known_filters is not None else []
    )
    return {
        "shape": shape,
        "sample": build_sample(shape, list_size),
        # What the API stores in `variables`: the top-level names only, which is
        # the granularity the field has always had.
        "variables": sorted(shape.keys()),
        "filters": sorted(collector.filters),
        "unknown_filters": unknown,
    }
