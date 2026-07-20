from starlette.middleware.cors import CORSMiddleware as CORSMiddleware  # noqa

# Re-export dynamic middleware (issue #763). Existing CORSMiddleware unchanged.
try:
    from .dynamic_cors import DynamicCORSMiddleware as DynamicCORSMiddleware  # noqa: F401
except Exception:  # pragma: no cover
    pass
