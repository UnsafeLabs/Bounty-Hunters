import re
from typing import Any, Dict, Set

def generate_unique_id(route: Dict[str, Any]) -> str:
    parts = []
    if route.get("prefix"):
        parts.append(route["prefix"].strip("/").replace("/", "_"))
    methods = route.get("methods", ["GET"])
    if methods:
        parts.append(list(methods)[0].lower())
    name = route.get("name", route.get("endpoint", "")).replace(" ", "_")
    parts.append(name)

    base = "_".join(parts).lower()
    seen: Set[str] = getattr(generate_unique_id, "_seen", set())
    if base in seen:
        suffix = 2
        while f"{base}_{suffix}" in seen:
            suffix += 1
        base = f"{base}_{suffix}"
    seen.add(base)
    generate_unique_id._seen = seen
    return base
