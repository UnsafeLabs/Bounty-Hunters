import contextvars
import logging

logger = logging.getLogger("fastapi")

# Context variable to track request ID across async boundaries
_request_id_var: contextvars.ContextVar[str | None] = contextvars.ContextVar(
    "request_id", default=None
)


class RequestIDFilter(logging.Filter):
    """Logging filter that injects request_id into log records."""

    def filter(self, record: logging.LogRecord) -> bool:
        request_id = _request_id_var.get()
        if request_id:
            record.request_id = request_id  # type: ignore[attr-defined]
        else:
            record.request_id = "-"  # type: ignore[attr-defined]
        return True
